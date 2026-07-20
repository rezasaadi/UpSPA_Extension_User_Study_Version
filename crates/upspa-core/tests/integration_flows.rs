use rand_chacha::ChaCha20Rng;
use rand_core::SeedableRng;
use upspa_core::protocol::{
    authenticate, cipher_sp_from_b64, decrypt_cid, decrypt_cj, migration, password_update,
    register, secret_update, setup, CipherSp, CredentialKind, CIPHERSP_V2_PT_LEN,
    LEGACY_CIPHERSP_PT_LEN, MAX_WEBSITE_PASSWORD_BYTES,
};
use upspa_core::sign::verify_detached;
use upspa_core::toprf::{toprf_server_eval, ToprfClient, ToprfPartial};
use upspa_core::types::{b64_encode, CtBlobB64, UpspaError};
#[test]
fn full_client_flow_smoke_test() {
    let uid = b"user123";
    let lsj = b"LS1";
    let password = b"benchmark password";
    let new_password = b"new benchmark password";
    let nsp = 5usize;
    let tsp = 3usize;
    let mut rng = ChaCha20Rng::from_seed([42u8; 32]);
    let (setup_out, _payloads) = setup::client_setup(uid, password, nsp, tsp, &mut rng);
    let (state, blinded) = ToprfClient::begin(password, &mut rng);
    let mut partials = Vec::new();
    for (id, share_bytes) in setup_out.shares.iter().take(tsp) {
        let y_i = toprf_server_eval(&blinded, share_bytes).unwrap();
        partials.push(ToprfPartial { id: *id, y: y_i });
    }
    let state_key = ToprfClient::finish(password, &state, &partials).unwrap();
    let reg =
        register::client_register(uid, lsj, &state_key, &setup_out.cid, nsp, &mut rng).unwrap();
    assert_eq!(reg.per_sp.len(), nsp);
    assert_eq!(reg.per_sp[0].cj.ct.len(), LEGACY_CIPHERSP_PT_LEN);
    let cj0 = reg.per_sp[0].cj.clone();
    let vinfo_reg = reg.to_ls.vinfo;
    let auth_q =
        authenticate::client_auth_prepare(uid, lsj, &state_key, &setup_out.cid, nsp).unwrap();
    assert_eq!(auth_q.per_sp.len(), nsp);
    for (i, m) in reg.per_sp.iter().enumerate() {
        assert_eq!(auth_q.per_sp[i].0, m.sp_id);
        assert_eq!(auth_q.per_sp[i].1, m.suid);
    }
    let cjs = vec![cj0.clone(); tsp];
    let auth_res = authenticate::client_auth_finish(uid, lsj, &auth_q.k0, &cjs).unwrap();
    assert_eq!(auth_res.credential_kind, CredentialKind::Derived);
    assert_eq!(auth_res.vinfo_prime, Some(vinfo_reg));
    assert_eq!(auth_res.website_password, None);
    let su_q =
        secret_update::client_secret_update_prepare(uid, lsj, &state_key, &setup_out.cid, nsp)
            .unwrap();
    let entered_website_password = "exact current pässword 🔐";
    let su_res = secret_update::client_secret_update_finish(
        uid,
        lsj,
        &su_q.k0,
        &cjs,
        entered_website_password,
        &mut rng,
    )
    .unwrap();
    assert_eq!(su_res.credential_kind, CredentialKind::EmbeddedPassword);
    assert_eq!(su_res.previous_credential_kind, CredentialKind::Derived);
    assert_eq!(su_res.old_ctr, 0);
    assert_eq!(su_res.new_ctr, 1);
    assert_eq!(su_res.cj_new.ct.len(), CIPHERSP_V2_PT_LEN);
    let cjs_new = vec![su_res.cj_new.clone(); tsp];
    let auth_res2 = authenticate::client_auth_finish(uid, lsj, &auth_q.k0, &cjs_new).unwrap();
    assert_eq!(auth_res2.credential_kind, CredentialKind::EmbeddedPassword);
    assert_eq!(auth_res2.vinfo_prime, None);
    assert_eq!(
        auth_res2.website_password.as_deref(),
        Some(entered_website_password)
    );
    assert_eq!(auth_res2.best_ctr, 1);
    let mixed_replicas = vec![cj0.clone(), su_res.cj_new.clone()];
    let mixed_auth =
        authenticate::client_auth_finish(uid, lsj, &auth_q.k0, &mixed_replicas).unwrap();
    assert_eq!(
        mixed_auth.website_password.as_deref(),
        Some(entered_website_password),
        "the newer embedded record must win over a stale legacy replica"
    );

    let second_website_password = "the user's later current password";
    let su_res2 = secret_update::client_secret_update_finish(
        uid,
        lsj,
        &su_q.k0,
        &cjs_new,
        second_website_password,
        &mut rng,
    )
    .unwrap();
    assert_eq!(
        su_res2.previous_credential_kind,
        CredentialKind::EmbeddedPassword
    );
    assert_eq!(su_res2.old_ctr, 1);
    assert_eq!(su_res2.new_ctr, 2);
    let second_auth =
        authenticate::client_auth_finish(uid, lsj, &auth_q.k0, &[su_res2.cj_new.clone()]).unwrap();
    assert_eq!(
        second_auth.website_password.as_deref(),
        Some(second_website_password)
    );
    let timestamp: u64 = 123456;
    let pw_res = password_update::client_password_update(
        uid,
        &state_key,
        &setup_out.cid,
        nsp,
        tsp,
        new_password,
        timestamp,
        &mut rng,
    )
    .unwrap();
    for m in pw_res.per_sp.iter() {
        let mut msg = [0u8; password_update::PWD_UPDATE_SIG_MSG_LEN];
        let mut off = 0;
        msg[off..off + 24].copy_from_slice(&pw_res.cid_new.nonce);
        off += 24;
        msg[off..off + 96].copy_from_slice(&pw_res.cid_new.ct);
        off += 96;
        msg[off..off + 16].copy_from_slice(&pw_res.cid_new.tag);
        off += 16;
        msg[off..off + 32].copy_from_slice(&m.k_i_new);
        off += 32;
        msg[off..off + 8].copy_from_slice(&timestamp.to_le_bytes());
        off += 8;
        msg[off..off + 4].copy_from_slice(&m.sp_id.to_le_bytes());
        off += 4;
        assert_eq!(off, password_update::PWD_UPDATE_SIG_MSG_LEN);
        verify_detached(&setup_out.sig_pk, &msg, &m.sig).unwrap();
    }
    let (st2, blinded2) = ToprfClient::begin(new_password, &mut rng);
    let mut new_partials = Vec::new();
    for m in pw_res.per_sp.iter().take(tsp) {
        let y_i = toprf_server_eval(&blinded2, &m.k_i_new).unwrap();
        new_partials.push(ToprfPartial {
            id: m.sp_id,
            y: y_i,
        });
    }
    let new_state_key = ToprfClient::finish(new_password, &st2, &new_partials).unwrap();
    let cid_old_pt = decrypt_cid(uid, &state_key, &setup_out.cid)
        .unwrap()
        .to_bytes();
    let cid_new_pt = decrypt_cid(uid, &new_state_key, &pw_res.cid_new)
        .unwrap()
        .to_bytes();
    assert_eq!(cid_new_pt, cid_old_pt);
}

#[test]
fn migration_embeds_exact_password_without_rotating_it() {
    let uid = b"migration-user";
    let lsj = b"https://example.test";
    let master_password = b"master password";
    let website_password = "Tricky: spaces/çığ/🔐/\0 preserved";
    let nsp = 3usize;
    let tsp = 2usize;
    let mut rng = ChaCha20Rng::from_seed([78u8; 32]);
    let (setup_out, _) = setup::client_setup(uid, master_password, nsp, tsp, &mut rng);
    let (state, blinded) = ToprfClient::begin(master_password, &mut rng);
    let partials = setup_out
        .shares
        .iter()
        .take(tsp)
        .map(|(id, share)| ToprfPartial {
            id: *id,
            y: toprf_server_eval(&blinded, share).unwrap(),
        })
        .collect::<Vec<_>>();
    let state_key = ToprfClient::finish(master_password, &state, &partials).unwrap();

    let migrated = migration::client_migrate_existing(
        uid,
        lsj,
        &state_key,
        &setup_out.cid,
        nsp,
        website_password,
        &mut rng,
    )
    .unwrap();
    assert_eq!(migrated.credential_kind, CredentialKind::EmbeddedPassword);
    assert_eq!(migrated.per_sp.len(), nsp);
    assert!(migrated
        .per_sp
        .iter()
        .all(|record| record.cj.ct.len() == CIPHERSP_V2_PT_LEN));

    let auth_q =
        authenticate::client_auth_prepare(uid, lsj, &state_key, &setup_out.cid, nsp).unwrap();
    let cjs = migrated
        .per_sp
        .iter()
        .take(tsp)
        .map(|record| record.cj.clone())
        .collect::<Vec<_>>();
    let auth = authenticate::client_auth_finish(uid, lsj, &auth_q.k0, &cjs).unwrap();
    assert_eq!(auth.credential_kind, CredentialKind::EmbeddedPassword);
    assert_eq!(auth.website_password.as_deref(), Some(website_password));
    assert_eq!(auth.vinfo_prime, None);
    assert_eq!(auth.best_ctr, 0);
}

#[test]
fn embedded_password_enforces_utf8_byte_cap_and_nonempty_input() {
    let uid = b"bounded-user";
    let lsj = b"bounded-site";
    let master_password = b"master password";
    let mut rng = ChaCha20Rng::from_seed([91u8; 32]);
    let (setup_out, _) = setup::client_setup(uid, master_password, 1, 1, &mut rng);
    let (state, blinded) = ToprfClient::begin(master_password, &mut rng);
    let share = &setup_out.shares[0];
    let partial = ToprfPartial {
        id: share.0,
        y: toprf_server_eval(&blinded, &share.1).unwrap(),
    };
    let state_key = ToprfClient::finish(master_password, &state, &[partial]).unwrap();

    let exact_limit = "é".repeat(MAX_WEBSITE_PASSWORD_BYTES / 2);
    let accepted = migration::client_migrate_existing(
        uid,
        lsj,
        &state_key,
        &setup_out.cid,
        1,
        &exact_limit,
        &mut rng,
    )
    .unwrap();
    assert_eq!(accepted.per_sp[0].cj.ct.len(), CIPHERSP_V2_PT_LEN);

    let too_long = format!("{exact_limit}é");
    assert!(matches!(
        migration::client_migrate_existing(
            uid,
            lsj,
            &state_key,
            &setup_out.cid,
            1,
            &too_long,
            &mut rng,
        ),
        Err(UpspaError::WebsitePasswordTooLong { max, got })
            if max == MAX_WEBSITE_PASSWORD_BYTES && got == MAX_WEBSITE_PASSWORD_BYTES + 2
    ));
    assert!(matches!(
        migration::client_migrate_existing(uid, lsj, &state_key, &setup_out.cid, 1, "", &mut rng,),
        Err(UpspaError::EmptyWebsitePassword)
    ));
}

#[test]
fn unknown_cj_lengths_are_rejected_before_aead_processing() {
    let invalid = CipherSp {
        nonce: [0u8; 24],
        ct: vec![0u8; LEGACY_CIPHERSP_PT_LEN + 1],
        tag: [0u8; 16],
    };
    assert!(matches!(
        decrypt_cj(b"uid", &[0u8; 32], &invalid),
        Err(UpspaError::InvalidCredentialRecord)
    ));

    let oversized_encoded = CtBlobB64 {
        nonce: b64_encode(&[0u8; 24]),
        ct: "A".repeat(1387),
        tag: b64_encode(&[0u8; 16]),
    };
    assert!(matches!(
        cipher_sp_from_b64(&oversized_encoded),
        Err(UpspaError::InvalidCredentialRecord)
    ));
}
