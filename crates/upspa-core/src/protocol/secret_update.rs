use crate::hash::hash_suid;
use crate::protocol::{
    decrypt_cid, decrypt_cj, encrypt_embedded_password_cj, CipherId, CipherSp, CredentialKind,
};
use crate::types::UpspaError;
use rand_core::{CryptoRng, RngCore};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SecretUpdateQueries {
    pub k0: [u8; 32],
    pub per_sp: Vec<(u32, [u8; 32])>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SecretUpdateOutput {
    pub credential_kind: CredentialKind,
    pub previous_credential_kind: CredentialKind,
    pub cj_new: CipherSp,
    pub old_ctr: u64,
    pub new_ctr: u64,
}
pub fn client_secret_update_prepare(
    uid: &[u8],
    lsj: &[u8],
    password_state_key: &[u8; 32],
    cid: &CipherId,
    nsp: usize,
) -> Result<SecretUpdateQueries, UpspaError> {
    let cid_pt = decrypt_cid(uid, password_state_key, cid)?;
    let rsp = cid_pt.rsp;
    let k0 = cid_pt.k0;
    let mut per_sp = Vec::with_capacity(nsp);
    for i in 1..=nsp {
        let suid = hash_suid(&rsp, lsj, i as u32);
        per_sp.push((i as u32, suid));
    }
    Ok(SecretUpdateQueries { k0, per_sp })
}
pub fn client_secret_update_finish<R: RngCore + CryptoRng>(
    uid: &[u8],
    _lsj: &[u8],
    k0: &[u8; 32],
    cjs: &[CipherSp],
    website_password: &str,
    rng: &mut R,
) -> Result<SecretUpdateOutput, UpspaError> {
    if cjs.is_empty() {
        return Err(UpspaError::InvalidLength {
            expected: 1,
            got: 0,
        });
    }
    let mut best = None;
    for cj in cjs {
        let pt = decrypt_cj(uid, k0, cj)?;
        if best
            .as_ref()
            .is_none_or(|current: &crate::protocol::CipherSpPlaintext| pt.ctr >= current.ctr)
        {
            best = Some(pt);
        }
    }
    let best = best.ok_or(UpspaError::Aead)?;
    let old_ctr = best.ctr;
    let previous_credential_kind = best.credential_kind();
    let new_ctr = old_ctr.checked_add(1).ok_or(UpspaError::CounterOverflow)?;
    let cj_new = encrypt_embedded_password_cj(uid, k0, website_password, new_ctr, rng)?;
    Ok(SecretUpdateOutput {
        credential_kind: CredentialKind::EmbeddedPassword,
        previous_credential_kind,
        cj_new,
        old_ctr,
        new_ctr,
    })
}
