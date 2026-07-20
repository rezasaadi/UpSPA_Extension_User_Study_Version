use crate::hash::hash_suid;
use crate::protocol::{
    decrypt_cid, encrypt_embedded_password_cj, CipherId, CipherSp, CredentialKind,
};
use crate::types::UpspaError;
use rand_core::{CryptoRng, RngCore};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MigrationSpMessage {
    pub sp_id: u32,
    pub suid: [u8; 32],
    pub cj: CipherSp,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MigrationOutput {
    pub credential_kind: CredentialKind,
    pub per_sp: Vec<MigrationSpMessage>,
}

/// Imports an existing website password into Cj without interacting with the
/// website and without generating a replacement website password.
pub fn client_migrate_existing<R: RngCore + CryptoRng>(
    uid: &[u8],
    lsj: &[u8],
    password_state_key: &[u8; 32],
    cid: &CipherId,
    nsp: usize,
    website_password: &str,
    rng: &mut R,
) -> Result<MigrationOutput, UpspaError> {
    let cid_pt = decrypt_cid(uid, password_state_key, cid)?;
    let cj = encrypt_embedded_password_cj(uid, &cid_pt.k0, website_password, 0, rng)?;
    let mut per_sp = Vec::with_capacity(nsp);
    for i in 1..=nsp {
        per_sp.push(MigrationSpMessage {
            sp_id: i as u32,
            suid: hash_suid(&cid_pt.rsp, lsj, i as u32),
            cj: cj.clone(),
        });
    }
    Ok(MigrationOutput {
        credential_kind: CredentialKind::EmbeddedPassword,
        per_sp,
    })
}
