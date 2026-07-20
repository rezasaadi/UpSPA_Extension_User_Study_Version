use crate::aead::{
    xchacha_decrypt_detached, xchacha_decrypt_detached_dynamic, xchacha_encrypt_detached_dynamic,
};
use crate::types::{CtBlob, CtBlobB64, DynamicCtBlob, UpspaError};
use ed25519_dalek::SigningKey;
use rand_core::RngCore;
use serde::{Deserialize, Serialize};
pub mod authenticate;
pub mod migration;
pub mod password_update;
pub mod register;
pub mod secret_update;
pub mod setup;
pub const CIPHERID_PT_LEN: usize = 96;
pub const LEGACY_CIPHERSP_PT_LEN: usize = 40;
pub const MAX_WEBSITE_PASSWORD_BYTES: usize = 1024;
const CIPHERSP_V2_MAGIC: &[u8; 4] = b"CJv2";
const CIPHERSP_V2_KIND_EMBEDDED_PASSWORD: u8 = 1;
const CIPHERSP_V2_HEADER_LEN: usize = 15;
pub const CIPHERSP_V2_PT_LEN: usize = CIPHERSP_V2_HEADER_LEN + MAX_WEBSITE_PASSWORD_BYTES;
pub type CipherId = CtBlob<CIPHERID_PT_LEN>;
pub type CipherSp = DynamicCtBlob;
const NONCE_B64_LEN: usize = 32;
const TAG_B64_LEN: usize = 22;
const LEGACY_CIPHERSP_CT_B64_LEN: usize = 54;
const CIPHERSP_V2_CT_B64_LEN: usize = 1386;

/// Parses only the two permitted Cj wire sizes. Checking encoded lengths
/// before Base64 decoding prevents an untrusted storage response from causing
/// an unbounded ciphertext allocation.
pub fn cipher_sp_from_b64(b64: &CtBlobB64) -> Result<CipherSp, UpspaError> {
    if b64.nonce.len() != NONCE_B64_LEN
        || b64.tag.len() != TAG_B64_LEN
        || (b64.ct.len() != LEGACY_CIPHERSP_CT_B64_LEN && b64.ct.len() != CIPHERSP_V2_CT_B64_LEN)
    {
        return Err(UpspaError::InvalidCredentialRecord);
    }
    let cj = DynamicCtBlob::from_b64(b64)?;
    if cj.ct.len() != LEGACY_CIPHERSP_PT_LEN && cj.ct.len() != CIPHERSP_V2_PT_LEN {
        return Err(UpspaError::InvalidCredentialRecord);
    }
    Ok(cj)
}
pub fn cipherid_aad(uid: &[u8]) -> Vec<u8> {
    let mut aad = Vec::with_capacity(uid.len() + 9);
    aad.extend_from_slice(uid);
    aad.extend_from_slice(b"|cipherid");
    aad
}
pub fn ciphersp_aad(uid: &[u8]) -> Vec<u8> {
    let mut aad = Vec::with_capacity(uid.len() + 9);
    aad.extend_from_slice(uid);
    aad.extend_from_slice(b"|ciphersp");
    aad
}
#[derive(Clone, Debug)]
pub struct CidPlaintext {
    pub ssk_bytes: [u8; 32],
    pub signing_key: SigningKey,
    pub rsp: [u8; 32],
    pub k0: [u8; 32],
}
impl CidPlaintext {
    pub fn to_bytes(&self) -> [u8; CIPHERID_PT_LEN] {
        let mut pt = [0u8; CIPHERID_PT_LEN];
        pt[0..32].copy_from_slice(&self.ssk_bytes);
        pt[32..64].copy_from_slice(&self.rsp);
        pt[64..96].copy_from_slice(&self.k0);
        pt
    }
}
pub fn parse_cipherid_pt(pt: &[u8; CIPHERID_PT_LEN]) -> CidPlaintext {
    let mut ssk_bytes = [0u8; 32];
    ssk_bytes.copy_from_slice(&pt[0..32]);
    let mut rsp = [0u8; 32];
    rsp.copy_from_slice(&pt[32..64]);
    let mut k0 = [0u8; 32];
    k0.copy_from_slice(&pt[64..96]);
    let signing_key = SigningKey::from_bytes(&ssk_bytes);
    CidPlaintext {
        ssk_bytes,
        signing_key,
        rsp,
        k0,
    }
}
pub fn decrypt_cid(
    uid: &[u8],
    state_key: &[u8; 32],
    cid: &CipherId,
) -> Result<CidPlaintext, UpspaError> {
    let aad = cipherid_aad(uid);
    let pt = xchacha_decrypt_detached(state_key, &aad, cid)?;
    Ok(parse_cipherid_pt(&pt))
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialKind {
    Derived,
    EmbeddedPassword,
}

#[derive(Clone, PartialEq, Eq)]
pub enum StoredCredential {
    DerivedSecret([u8; 32]),
    EmbeddedWebsitePassword(String),
}

#[derive(Clone, PartialEq, Eq)]
pub struct CipherSpPlaintext {
    pub credential: StoredCredential,
    pub ctr: u64,
}

impl CipherSpPlaintext {
    pub fn credential_kind(&self) -> CredentialKind {
        match self.credential {
            StoredCredential::DerivedSecret(_) => CredentialKind::Derived,
            StoredCredential::EmbeddedWebsitePassword(_) => CredentialKind::EmbeddedPassword,
        }
    }
}

pub fn legacy_ciphersp_plaintext(rlsj: &[u8; 32], ctr: u64) -> [u8; LEGACY_CIPHERSP_PT_LEN] {
    let mut pt = [0u8; LEGACY_CIPHERSP_PT_LEN];
    pt[0..32].copy_from_slice(rlsj);
    pt[32..40].copy_from_slice(&ctr.to_le_bytes());
    pt
}

pub fn parse_ciphersp_pt(pt: &[u8]) -> Result<CipherSpPlaintext, UpspaError> {
    if pt.len() == LEGACY_CIPHERSP_PT_LEN {
        let mut rlsj = [0u8; 32];
        rlsj.copy_from_slice(&pt[0..32]);
        let mut ctr_bytes = [0u8; 8];
        ctr_bytes.copy_from_slice(&pt[32..40]);
        return Ok(CipherSpPlaintext {
            credential: StoredCredential::DerivedSecret(rlsj),
            ctr: u64::from_le_bytes(ctr_bytes),
        });
    }

    if pt.len() != CIPHERSP_V2_PT_LEN
        || &pt[0..4] != CIPHERSP_V2_MAGIC
        || pt[4] != CIPHERSP_V2_KIND_EMBEDDED_PASSWORD
    {
        return Err(UpspaError::InvalidCredentialRecord);
    }

    let mut ctr_bytes = [0u8; 8];
    ctr_bytes.copy_from_slice(&pt[5..13]);
    let mut len_bytes = [0u8; 2];
    len_bytes.copy_from_slice(&pt[13..15]);
    let password_len = u16::from_le_bytes(len_bytes) as usize;
    if password_len == 0 || password_len > MAX_WEBSITE_PASSWORD_BYTES {
        return Err(UpspaError::InvalidCredentialRecord);
    }
    let password = String::from_utf8(
        pt[CIPHERSP_V2_HEADER_LEN..CIPHERSP_V2_HEADER_LEN + password_len].to_vec(),
    )
    .map_err(|_| UpspaError::InvalidWebsitePasswordUtf8)?;
    Ok(CipherSpPlaintext {
        credential: StoredCredential::EmbeddedWebsitePassword(password),
        ctr: u64::from_le_bytes(ctr_bytes),
    })
}

fn encode_embedded_password_pt(
    website_password: &str,
    ctr: u64,
    rng: &mut impl RngCore,
) -> Result<Vec<u8>, UpspaError> {
    let password = website_password.as_bytes();
    if password.is_empty() {
        return Err(UpspaError::EmptyWebsitePassword);
    }
    if password.len() > MAX_WEBSITE_PASSWORD_BYTES {
        return Err(UpspaError::WebsitePasswordTooLong {
            max: MAX_WEBSITE_PASSWORD_BYTES,
            got: password.len(),
        });
    }
    let password_len =
        u16::try_from(password.len()).map_err(|_| UpspaError::InvalidCredentialRecord)?;
    let mut pt = vec![0u8; CIPHERSP_V2_PT_LEN];
    rng.fill_bytes(&mut pt[CIPHERSP_V2_HEADER_LEN..]);
    pt[0..4].copy_from_slice(CIPHERSP_V2_MAGIC);
    pt[4] = CIPHERSP_V2_KIND_EMBEDDED_PASSWORD;
    pt[5..13].copy_from_slice(&ctr.to_le_bytes());
    pt[13..15].copy_from_slice(&password_len.to_le_bytes());
    pt[CIPHERSP_V2_HEADER_LEN..CIPHERSP_V2_HEADER_LEN + password.len()].copy_from_slice(password);
    Ok(pt)
}

pub fn encrypt_embedded_password_cj(
    uid: &[u8],
    k0: &[u8; 32],
    website_password: &str,
    ctr: u64,
    rng: &mut impl RngCore,
) -> Result<CipherSp, UpspaError> {
    let pt = encode_embedded_password_pt(website_password, ctr, rng)?;
    Ok(xchacha_encrypt_detached_dynamic(
        k0,
        &ciphersp_aad(uid),
        &pt,
        rng,
    ))
}
pub fn decrypt_cj(
    uid: &[u8],
    k0: &[u8; 32],
    cj: &CipherSp,
) -> Result<CipherSpPlaintext, UpspaError> {
    if cj.ct.len() != LEGACY_CIPHERSP_PT_LEN && cj.ct.len() != CIPHERSP_V2_PT_LEN {
        return Err(UpspaError::InvalidCredentialRecord);
    }
    let aad = ciphersp_aad(uid);
    let pt = xchacha_decrypt_detached_dynamic(k0, &aad, cj)?;
    parse_ciphersp_pt(&pt)
}
