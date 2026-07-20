use crate::hash::{hash_suid, hash_vinfo};
use crate::protocol::{
    decrypt_cid, decrypt_cj, CipherId, CipherSp, CredentialKind, StoredCredential,
};
use crate::types::UpspaError;
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AuthQueries {
    pub k0: [u8; 32],
    pub per_sp: Vec<(u32, [u8; 32])>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct AuthResult {
    pub credential_kind: CredentialKind,
    pub vinfo_prime: Option<[u8; 32]>,
    pub website_password: Option<String>,
    pub best_ctr: u64,
}
pub fn client_auth_prepare(
    uid: &[u8],
    lsj: &[u8],
    password_state_key: &[u8; 32],
    cid: &CipherId,
    nsp: usize,
) -> Result<AuthQueries, UpspaError> {
    let cid_pt = decrypt_cid(uid, password_state_key, cid)?;
    let rsp = cid_pt.rsp;
    let k0 = cid_pt.k0;
    let mut per_sp = Vec::with_capacity(nsp);
    for i in 1..=nsp {
        let suid = hash_suid(&rsp, lsj, i as u32);
        per_sp.push((i as u32, suid));
    }
    Ok(AuthQueries { k0, per_sp })
}
pub fn client_auth_finish(
    uid: &[u8],
    lsj: &[u8],
    k0: &[u8; 32],
    cjs: &[CipherSp],
) -> Result<AuthResult, UpspaError> {
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
    let best_ctr = best.ctr;
    match best.credential {
        StoredCredential::DerivedSecret(rlsj) => Ok(AuthResult {
            credential_kind: CredentialKind::Derived,
            vinfo_prime: Some(hash_vinfo(&rlsj, lsj)),
            website_password: None,
            best_ctr,
        }),
        StoredCredential::EmbeddedWebsitePassword(website_password) => Ok(AuthResult {
            credential_kind: CredentialKind::EmbeddedPassword,
            vinfo_prime: None,
            website_password: Some(website_password),
            best_ctr,
        }),
    }
}
