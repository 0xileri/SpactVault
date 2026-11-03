//! Unit tests: authorization, policy validation, state machine and budget accounting.
//! Test IDs (T01..T18) refer to the Security Lab table in AGENTS.md section 10.
//! Cross-contract behavior (real token transfers, `#[private]`, concurrency, gas) is covered by
//! the sandbox tests in `contracts/integration-tests`.

use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{test_vm_config, testing_env, PromiseResult, RuntimeFeesConfig};

const UNIT: u128 = 1_000_000; // 6-decimal test token
const DAY: u64 = 20_000;
const NOW: u64 = DAY * NS_PER_DAY + 12 * 3600 * NS_PER_SEC; // midday UTC
const TTL_SEC: u32 = 3600;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn owner() -> AccountId {
    acc("owner.test.near")
}
fn agent() -> AccountId {
    acc("agent.test.near")
}
fn vault() -> AccountId {
    acc("vault.test.near")
}
fn token() -> AccountId {
    acc("token.test.near")
}
fn api() -> AccountId {
    acc("api.test.near")
}
fn mallory() -> AccountId {
    acc("mallory.test.near")
}

fn token_policy() -> TokenPolicy {
    TokenPolicy {
        token: token(),
        auto_limit: U128(10 * UNIT),
        hard_tx_limit: U128(30 * UNIT),
        daily_limit: U128(50 * UNIT),
    }
}

fn policy() -> Policy {
    Policy {
        tokens: vec![token_policy()],
        recipients: vec![api()],
        max_open_approvals: 5,
        max_requests_per_day: 50,
        approval_ttl_sec: TTL_SEC,
        cross_chain: vec![],
    }
}

fn set_ctx(predecessor: AccountId, deposit_yocto: u128, now: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(vault())
        .predecessor_account_id(predecessor.clone())
        .signer_account_id(predecessor)
        .attached_deposit(NearToken::from_yoctonear(deposit_yocto))
        .prepaid_gas(Gas::from_tgas(300))
        .block_timestamp(now)
        .build());
}

fn set_callback_ctx(now: u64, result: PromiseResult) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(vault())
            .predecessor_account_id(vault())
            .prepaid_gas(Gas::from_tgas(300))
            .block_timestamp(now)
            .build(),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
}

fn setup() -> Vault {
    set_ctx(vault(), 0, NOW);
    Vault::new(owner(), vec![agent()], "sandbox".into(), policy())
}

/// Agent requests a payment at `now`. Returns the immediate outcome, or the stored request's
/// state when the call dispatched a transfer.
fn request_at(v: &mut Vault, id: &str, amount: u128, now: u64) -> (Status, ReasonCode) {
    set_ctx(agent(), 0, now);
    match v.request_direct_payment(id.into(), token(), U128(amount), api(), "test payment".into()) {
        PromiseOrValue::Value(o) => (o.status, o.reason_code),
        PromiseOrValue::Promise(_) => {
            let r = v.get_request(id.into()).expect("dispatched request is stored");
            (r.status, r.reason_code)
        }
    }
}

fn request(v: &mut Vault, id: &str, amount: u128) -> (Status, ReasonCode) {
    request_at(v, id, amount, NOW)
}

fn approve(v: &mut Vault, id: &str) -> PaymentOutcome {
    let hash = v.get_request(id.into()).unwrap().request_hash;
    set_ctx(owner(), 1, NOW);
    v.approve_request(id.into(), hash)
}

fn budget(v: &Vault, day: u64) -> BudgetView {
    v.get_budget(token(), Some(day)).unwrap()
}

fn resolve(v: &mut Vault, id: &str, ok: bool, now: u64) -> PaymentOutcome {
    let result = if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed };
    set_callback_ctx(now, result);
    v.on_transfer_result(id.into())
}

fn expect_value(p: PromiseOrValue<PaymentOutcome>) -> PaymentOutcome {
    match p {
        PromiseOrValue::Value(o) => o,
        PromiseOrValue::Promise(_) => panic!("expected an immediate outcome, got a dispatch"),
    }
}

// ------------------------------------------------------------------ init and config

#[test]
fn init_sets_config() {
    let v = setup();
    let c = v.get_config();
    assert_eq!(c.owner, owner());
    assert_eq!(c.agents, vec![agent()]);
    assert_eq!(c.network, "sandbox");
    assert_eq!(c.policy_version, 1);
    assert!(!c.paused);
    assert_eq!(v.get_policy(), policy());
}

#[test]
#[should_panic(expected = "INIT_NOT_SELF")]
fn init_by_third_party_fails() {
    set_ctx(mallory(), 0, NOW);
    Vault::new(mallory(), vec![agent()], "sandbox".into(), policy());
}

#[test]
#[should_panic(expected = "INVALID_CONFIG: agent must not be the owner")]
fn agent_cannot_be_owner() {
    set_ctx(vault(), 0, NOW);
    Vault::new(owner(), vec![owner()], "sandbox".into(), policy());
}

#[test]
#[should_panic(expected = "INVALID_CONFIG: network")]
fn init_rejects_bad_network() {
    set_ctx(vault(), 0, NOW);
    Vault::new(owner(), vec![agent()], "Main Net".into(), policy());
}

#[test]
fn policy_validation_rejects_unsafe_limits() {
    let v = vault();
    let with = |f: fn(&mut Policy)| {
        let mut p = policy();
        f(&mut p);
        validate_policy(&p, &v)
    };
    assert!(with(|_| {}).is_ok());
    assert!(with(|p| p.tokens[0].auto_limit = U128(31 * UNIT)).is_err());
    assert!(with(|p| p.tokens[0].hard_tx_limit = U128(51 * UNIT)).is_err());
    assert!(with(|p| p.tokens[0].hard_tx_limit = U128(0)).is_err());
    assert!(with(|p| p.tokens[0].daily_limit = U128(0)).is_err());
    assert!(with(|p| p.tokens.push(token_policy())).is_err());
    assert!(with(|p| p.recipients.push(api())).is_err());
    assert!(with(|p| p.recipients.push("vault.test.near".parse().unwrap())).is_err());
    assert!(with(|p| p.tokens[0].token = "vault.test.near".parse().unwrap()).is_err());
    assert!(with(|p| p.max_open_approvals = 0).is_err());
    assert!(with(|p| p.max_requests_per_day = 0).is_err());
    assert!(with(|p| p.approval_ttl_sec = 59).is_err());
    assert!(with(|p| p.approval_ttl_sec = MAX_APPROVAL_TTL_SEC + 1).is_err());
    // auto_limit 0 is allowed: every payment then needs approval
    assert!(with(|p| p.tokens[0].auto_limit = U128(0)).is_ok());
}

// ------------------------------------------------------------------ T05 owner-only methods

#[test]
#[should_panic(expected = "NOT_OWNER")]
fn t05_agent_cannot_set_policy() {
    let mut v = setup();
    set_ctx(agent(), 1, NOW);
    v.set_policy(policy());
}

#[test]
#[should_panic(expected = "NOT_OWNER")]
fn t05_agent_cannot_pause_or_unpause() {
    let mut v = setup();
    set_ctx(agent(), 1, NOW);
    v.set_paused(false);
}

#[test]
#[should_panic(expected = "NOT_OWNER")]
fn t05_agent_cannot_add_agent() {
    let mut v = setup();
    set_ctx(agent(), 1, NOW);
    v.add_agent(mallory());
}

#[test]
#[should_panic(expected = "NOT_OWNER")]
fn t05_agent_cannot_approve_own_request() {
    let mut v = setup();
    request(&mut v, "r1", 25 * UNIT);
    let hash = v.get_request("r1".into()).unwrap().request_hash;
    set_ctx(agent(), 1, NOW);
    v.approve_request("r1".into(), hash);
}

#[test]
#[should_panic(expected = "NOT_OWNER")]
fn t05_agent_cannot_withdraw() {
    let mut v = setup();
    set_ctx(agent(), 1, NOW);
    v.owner_withdraw(token(), U128(UNIT), agent()).detach();
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn owner_methods_require_full_access_key_deposit() {
    let mut v = setup();
    set_ctx(owner(), 0, NOW);
    v.set_paused(true);
}

#[test]
#[should_panic(expected = "NOT_AGENT")]
fn stranger_cannot_request_payment() {
    let mut v = setup();
    set_ctx(mallory(), 0, NOW);
    v.request_direct_payment("r1".into(), token(), U128(UNIT), api(), String::new()).detach();
}

#[test]
#[should_panic(expected = "NOT_AGENT")]
fn owner_is_not_an_agent() {
    let mut v = setup();
    set_ctx(owner(), 0, NOW);
    v.request_direct_payment("r1".into(), token(), U128(UNIT), api(), String::new()).detach();
}

#[test]
#[should_panic(expected = "INSUFFICIENT_GAS")]
fn request_without_enough_gas_fails_before_state_changes() {
    let mut v = setup();
    testing_env!(VMContextBuilder::new()
        .current_account_id(vault())
        .predecessor_account_id(agent())
        .prepaid_gas(Gas::from_tgas(20))
        .block_timestamp(NOW)
        .build());
    v.request_direct_payment("r1".into(), token(), U128(UNIT), api(), String::new()).detach();
}

// ------------------------------------------------------------------ S1 auto payment

#[test]
fn s1_auto_payment_reserves_and_dispatches_transfer() {
    let mut v = setup();
    assert_eq!(request(&mut v, "r1", 3 * UNIT), (Status::TransferPending, ReasonCode::TransferPending));
    let b = budget(&v, DAY);
    assert_eq!(b.pending.0, 3 * UNIT);
    assert_eq!(b.executed.0, 0);
    assert_eq!(b.available.0, 47 * UNIT);

    // exactly one ft_transfer to the token contract with 1 yocto, then the private callback
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 2);
    assert_eq!(receipts[0].receiver_id, token());
    match &receipts[0].actions[0] {
        MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. } => {
            assert_eq!(method_name, b"ft_transfer");
            assert_eq!(*attached_deposit, NearToken::from_yoctonear(1));
            let args: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(args).unwrap();
            assert_eq!(args["receiver_id"], "api.test.near");
            assert_eq!(args["amount"], (3 * UNIT).to_string());
        }
        other => panic!("unexpected action {other:?}"),
    }
    assert_eq!(receipts[1].receiver_id, vault());
    match &receipts[1].actions[0] {
        MockAction::FunctionCallWeight { method_name, .. } => {
            assert_eq!(method_name, b"on_transfer_result")
        }
        other => panic!("unexpected action {other:?}"),
    }

    let o = resolve(&mut v, "r1", true, NOW);
    assert_eq!(o.status, Status::Settled);
    let b = budget(&v, DAY);
    assert_eq!((b.executed.0, b.pending.0), (3 * UNIT, 0));
}

#[test]
fn auto_limit_is_inclusive() {
    let mut v = setup();
    assert_eq!(request(&mut v, "r1", 10 * UNIT).0, Status::TransferPending);
    assert_eq!(request(&mut v, "r2", 10 * UNIT + 1).0, Status::AwaitingApproval);
}

// ------------------------------------------------------------------ T01, T11, T12 blocked requests

#[test]
fn t01_over_hard_cap_is_blocked_without_reservation() {
    let mut v = setup();
    assert_eq!(request(&mut v, "r1", 30 * UNIT + 1), (Status::Blocked, ReasonCode::HardCapExceeded));
    assert!(v.get_request("r1".into()).is_none(), "blocked requests are not stored");
    assert_eq!(budget(&v, DAY).pending.0, 0);
    assert!(get_created_receipts().is_empty());
    assert!(get_logs()[0].contains("request_blocked"));
}

#[test]
fn t11_invalid_inputs_are_blocked() {
    let mut v = setup();
    assert_eq!(request(&mut v, "r1", 0).1, ReasonCode::InvalidAmount);
    assert_eq!(request(&mut v, "", UNIT).1, ReasonCode::InvalidRequestId);
    assert_eq!(request(&mut v, "has space", UNIT).1, ReasonCode::InvalidRequestId);
    assert_eq!(request(&mut v, &"x".repeat(65), UNIT).1, ReasonCode::InvalidRequestId);

    for reason in ["a".repeat(MAX_REASON_LEN + 1), "line\nbreak".to_string()] {
        set_ctx(agent(), 0, NOW);
        let o = expect_value(v.request_direct_payment("r2".into(), token(), U128(UNIT), api(), reason));
        assert_eq!(o.reason_code, ReasonCode::InvalidReason);
    }
    assert_eq!(v.get_config().request_count, 0);
}

#[test]
fn t12_unlisted_token_or_recipient_is_blocked() {
    let mut v = setup();
    set_ctx(agent(), 0, NOW);
    let scam = acc("scam-token.test.near");
    let o = expect_value(v.request_direct_payment("r1".into(), scam, U128(UNIT), api(), String::new()));
    assert_eq!(o.reason_code, ReasonCode::TokenNotAllowed);
    let o =
        expect_value(v.request_direct_payment("r2".into(), token(), U128(UNIT), mallory(), String::new()));
    assert_eq!(o.reason_code, ReasonCode::RecipientNotAllowed);
    assert!(get_created_receipts().is_empty());
}

#[test]
fn paused_vault_blocks_new_requests() {
    let mut v = setup();
    set_ctx(owner(), 1, NOW);
    v.set_paused(true);
    assert_eq!(request(&mut v, "r1", UNIT), (Status::Blocked, ReasonCode::VaultPaused));
}

// ------------------------------------------------------------------ S2 approval flow

#[test]
fn s2_large_payment_needs_exact_owner_approval() {
    let mut v = setup();
    assert_eq!(
        request(&mut v, "r1", 25 * UNIT),
        (Status::AwaitingApproval, ReasonCode::RequiresOwnerApproval)
    );
    assert_eq!(v.get_config().open_approvals, 1);
    assert!(get_created_receipts().is_empty(), "nothing moves before approval");

    let o = approve(&mut v, "r1");
    assert_eq!(o.status, Status::Approved);
    assert_eq!(v.get_request("r1".into()).unwrap().approved_by, Some(owner()));
    assert_eq!(budget(&v, DAY).pending.0, 0, "approval alone reserves nothing");

    set_ctx(agent(), 0, NOW);
    v.execute_request("r1".into()).detach();
    assert_eq!(v.get_request("r1".into()).unwrap().status, Status::TransferPending);
    assert_eq!(budget(&v, DAY).pending.0, 25 * UNIT);
    assert_eq!(v.get_config().open_approvals, 0);

    resolve(&mut v, "r1", true, NOW);
    assert_eq!(budget(&v, DAY).executed.0, 25 * UNIT);
}

#[test]
#[should_panic(expected = "HASH_MISMATCH")]
fn t02_approval_of_a_different_request_body_fails() {
    // The owner's client hashes what it displayed. If a compromised backend showed recipient B
    // while the stored request pays recipient A, the hashes differ and approval fails.
    let mut v = setup();
    request(&mut v, "r1", 25 * UNIT);
    let mut shown = v.get_request("r1".into()).unwrap();
    shown.recipient = mallory();
    let shown_hash = request_hash("sandbox", "vault.test.near", &shown);
    set_ctx(owner(), 1, NOW);
    v.approve_request("r1".into(), shown_hash);
}

#[test]
fn t02_resubmitting_an_approved_id_with_new_terms_is_a_duplicate() {
    let mut v = setup();
    request(&mut v, "r1", 25 * UNIT);
    approve(&mut v, "r1");
    set_ctx(agent(), 0, NOW);
    let o = expect_value(v.request_direct_payment(
        "r1".into(),
        token(),
        U128(25 * UNIT),
        mallory(),
        String::new(),
    ));
    assert_eq!(o.reason_code, ReasonCode::DuplicateRequest);
    assert_eq!(v.get_request("r1".into()).unwrap().recipient, api());
}

#[test]
#[should_panic(expected = "INVALID_STATE")]
fn t03_approved_request_executes_once() {
    let mut v = setup();
    request(&mut v, "r1", 25 * UNIT);
    approve(&mut v, "r1");
    set_ctx(agent(), 0, NOW);
    v.execute_request("r1".into()).detach();
    set_ctx(agent(), 0, NOW);
    v.execute_request("r1".into()).detach();
}

#[test]
fn t03_duplicate_request_id_is_blocked() {
    let mut v = setup();
    request(&mut v, "r1", 3 * UNIT);
    assert_eq!(request(&mut v, "r1", 3 * UNIT), (Status::Blocked, ReasonCode::DuplicateRequest));
    assert_eq!(budget(&v, DAY).pending.0, 3 * UNIT);
}

#[test]
#[should_panic(expected = "INVALID_STATE")]
fn approve_twice_fails() {
    let mut v = setup();
    request(&mut v, "r1", 25 * UNIT);
    approve(&mut v, "r1");
    approve(&mut v, "r1");
}

#[test]
#[should_panic(expected = "NOT_AUTHORIZED")]
fn stranger_cannot_execute_approved_request() {
    let mut v = setup();
    request(&mut v, "r1", 25 * UNIT);
    approve(&mut v, "r1");
    set_ctx(mallory(), 0, NOW);
    v.execute_request("r1".into()).detach();
}

#[test]
fn owner_can_execute_approved_request() {
    let mut v = setup();
    request(&mut v, "r1", 25 * UNIT);
    approve(&mut v, "r1");
    set_ctx(owner(), 0, NOW);
    v.execute_request("r1".into()).detach();
    assert_eq!(v.get_request("r1".into()).unwrap().status, Status::TransferPending);
}

#[test]
fn reject_denies_and_frees_slot() {
    let mut v = setup();
    request(&mut v, "r1", 25 * UNIT);
    set_ctx(owner(), 1, NOW);
    let o = v.reject_request("r1".into());
    assert_eq!((o.status, o.reason_code), (Status::Denied, ReasonCode::OwnerDenied));
    assert_eq!(v.get_config().open_approvals, 0);
}

#[test]
#[should_panic(expected = "INVALID_STATE")]
fn denied_request_cannot_be_approved() {
    let mut v = setup();
    request(&mut v, "r1", 25 * UNIT);
    set_ctx(owner(), 1, NOW);
    v.reject_request("r1".into());
    approve(&mut v, "r1");
}

// ------------------------------------------------------------------ T04 budget

#[test]
fn t04_split_requests_cannot_exceed_daily_budget() {
    let mut v = setup();
    let mut dispatched = 0;
    for i in 0..6 {
        match request(&mut v, &format!("split-{i}"), 10 * UNIT) {
            (Status::TransferPending, _) => dispatched += 1,
            (Status::Blocked, ReasonCode::DailyBudgetExceeded) => {}
            other => panic!("unexpected {other:?}"),
        }
    }
    assert_eq!(dispatched, 5);
    let b = budget(&v, DAY);
    assert_eq!(b.pending.0 + b.executed.0, 50 * UNIT);
    assert_eq!(b.available.0, 0);
}

#[test]
#[should_panic(expected = "DAILY_BUDGET_EXCEEDED")]
fn approvals_never_bypass_daily_budget() {
    let mut v = setup();
    request(&mut v, "a", 30 * UNIT);
    request(&mut v, "b", 30 * UNIT);
    approve(&mut v, "a");
    approve(&mut v, "b");
    set_ctx(agent(), 0, NOW);
    v.execute_request("a".into()).detach();
    set_ctx(agent(), 0, NOW);
    v.execute_request("b".into()).detach();
}

#[test]
fn request_that_cannot_fit_todays_budget_is_blocked_not_queued() {
    let mut v = setup();
    for i in 0..4 {
        request(&mut v, &format!("s{i}"), 10 * UNIT);
    }
    assert_eq!(request(&mut v, "big", 25 * UNIT), (Status::Blocked, ReasonCode::DailyBudgetExceeded));
}

#[test]
fn lowering_the_daily_limit_leaves_zero_available() {
    let mut v = setup();
    request(&mut v, "r1", 10 * UNIT);
    let mut p = policy();
    p.tokens[0] = TokenPolicy {
        auto_limit: U128(UNIT),
        hard_tx_limit: U128(5 * UNIT),
        daily_limit: U128(5 * UNIT),
        ..token_policy()
    };
    set_ctx(owner(), 1, NOW);
    v.set_policy(p);
    assert_eq!(budget(&v, DAY).available.0, 0);
    assert_eq!(request(&mut v, "r2", UNIT).1, ReasonCode::DailyBudgetExceeded);
}

// ------------------------------------------------------------------ T07 expiry

#[test]
#[should_panic(expected = "REQUEST_EXPIRED")]
fn t07_expired_request_cannot_be_approved() {
    let mut v = setup();
    request(&mut v, "r1", 25 * UNIT);
    let hash = v.get_request("r1".into()).unwrap().request_hash;
    set_ctx(owner(), 1, NOW + u64::from(TTL_SEC) * NS_PER_SEC + 1);
    v.approve_request("r1".into(), hash);
}

#[test]
#[should_panic(expected = "APPROVAL_EXPIRED")]
fn t07_expired_approval_cannot_execute() {
    let mut v = setup();
    request(&mut v, "r1", 25 * UNIT);
    approve(&mut v, "r1");
    set_ctx(agent(), 0, NOW + u64::from(TTL_SEC) * NS_PER_SEC + 1);
    v.execute_request("r1".into()).detach();
}

#[test]
fn expire_request_only_after_expiry() {
    let mut v = setup();
    request(&mut v, "r1", 25 * UNIT);
    let later = NOW + u64::from(TTL_SEC) * NS_PER_SEC + 1;
    set_ctx(mallory(), 0, later);
    let o = v.expire_request("r1".into());
    assert_eq!(o.status, Status::Expired);
    assert_eq!(v.get_config().open_approvals, 0);
}

#[test]
#[should_panic(expected = "NOT_EXPIRED")]
fn expire_request_before_expiry_fails() {
    let mut v = setup();
    request(&mut v, "r1", 25 * UNIT);
    set_ctx(mallory(), 0, NOW + 1);
    v.expire_request("r1".into());
}

// ------------------------------------------------------------------ T08, T17 transfer results

#[test]
fn t08_failed_transfer_releases_reservation_once() {
    let mut v = setup();
    request(&mut v, "r1", 10 * UNIT);
    let o = resolve(&mut v, "r1", false, NOW);
    assert_eq!((o.status, o.reason_code), (Status::TransferFailed, ReasonCode::SourceTransferFailed));
    let b = budget(&v, DAY);
    assert_eq!((b.pending.0, b.executed.0, b.available.0), (0, 0, 50 * UNIT));

    // a second callback (or a retry) changes nothing
    let again = resolve(&mut v, "r1", true, NOW);
    assert_eq!(again.status, Status::TransferFailed);
    let b = budget(&v, DAY);
    assert_eq!((b.pending.0, b.executed.0), (0, 0));
}

#[test]
fn t17_settled_request_ignores_repeated_callbacks() {
    let mut v = setup();
    request(&mut v, "r1", 10 * UNIT);
    resolve(&mut v, "r1", true, NOW);
    resolve(&mut v, "r1", false, NOW);
    resolve(&mut v, "r1", true, NOW);
    let b = budget(&v, DAY);
    assert_eq!((b.pending.0, b.executed.0), (0, 10 * UNIT));
    assert_eq!(v.get_request("r1".into()).unwrap().status, Status::Settled);
}

// ------------------------------------------------------------------ T09 pause

#[test]
#[should_panic(expected = "VAULT_PAUSED")]
fn t09_pause_blocks_approved_execution() {
    let mut v = setup();
    request(&mut v, "r1", 25 * UNIT);
    approve(&mut v, "r1");
    set_ctx(owner(), 1, NOW);
    v.set_paused(true);
    set_ctx(agent(), 0, NOW);
    v.execute_request("r1".into()).detach();
}

// ------------------------------------------------------------------ T10 day boundary

#[test]
fn t10_reservation_stays_on_its_original_day() {
    let mut v = setup();
    let last_ns_of_day = (DAY + 1) * NS_PER_DAY - 1;
    assert_eq!(request_at(&mut v, "late", 10 * UNIT, last_ns_of_day).0, Status::TransferPending);
    assert_eq!(v.get_request("late".into()).unwrap().reserved_day, Some(DAY));

    // callback lands after midnight
    resolve(&mut v, "late", true, (DAY + 1) * NS_PER_DAY + 5);
    let today = budget(&v, DAY);
    let tomorrow = budget(&v, DAY + 1);
    assert_eq!((today.executed.0, today.pending.0), (10 * UNIT, 0));
    assert_eq!((tomorrow.executed.0, tomorrow.pending.0), (0, 0));
    assert_eq!(tomorrow.available.0, 50 * UNIT);
}

// ------------------------------------------------------------------ T15 version / domain binding

#[test]
#[should_panic(expected = "POLICY_VERSION_CHANGED")]
fn t15_policy_change_invalidates_pending_approval() {
    let mut v = setup();
    request(&mut v, "r1", 25 * UNIT);
    let hash = v.get_request("r1".into()).unwrap().request_hash;
    set_ctx(owner(), 1, NOW);
    v.set_policy(policy());
    set_ctx(owner(), 1, NOW);
    v.approve_request("r1".into(), hash);
}

#[test]
#[should_panic(expected = "POLICY_VERSION_CHANGED")]
fn t15_policy_change_invalidates_approved_request() {
    let mut v = setup();
    request(&mut v, "r1", 25 * UNIT);
    approve(&mut v, "r1");
    set_ctx(owner(), 1, NOW);
    v.set_policy(policy());
    set_ctx(agent(), 0, NOW);
    v.execute_request("r1".into()).detach();
}

#[test]
fn t15_hash_is_bound_to_vault_network_and_policy_version() {
    let mut v = setup();
    request(&mut v, "r1", 25 * UNIT);
    let req = v.get_request("r1".into()).unwrap();
    let here = request_hash("sandbox", "vault.test.near", &req);
    assert_eq!(here, req.request_hash);
    assert_ne!(here, request_hash("sandbox", "other-vault.test.near", &req));
    assert_ne!(here, request_hash("mainnet", "vault.test.near", &req));
    let mut bumped = req.clone();
    bumped.policy_version += 1;
    assert_ne!(here, request_hash("sandbox", "vault.test.near", &bumped));
}

#[test]
#[should_panic(expected = "AGENT_NOT_ALLOWED")]
fn removed_agent_requests_cannot_execute() {
    let mut v = setup();
    request(&mut v, "r1", 25 * UNIT);
    approve(&mut v, "r1");
    set_ctx(owner(), 1, NOW);
    v.remove_agent(agent());
    set_ctx(owner(), 0, NOW);
    v.execute_request("r1".into()).detach();
}

// ------------------------------------------------------------------ storage / spam bounds

#[test]
fn open_approvals_are_capped() {
    let mut v = setup();
    for i in 0..5 {
        assert_eq!(request(&mut v, &format!("big-{i}"), 11 * UNIT).0, Status::AwaitingApproval);
    }
    assert_eq!(request(&mut v, "big-5", 11 * UNIT), (Status::Blocked, ReasonCode::TooManyOpenApprovals));
}

#[test]
fn stored_requests_per_day_are_capped() {
    let mut v = setup();
    let mut p = policy();
    p.max_requests_per_day = 2;
    set_ctx(owner(), 1, NOW);
    v.set_policy(p);
    request(&mut v, "a", UNIT);
    request(&mut v, "b", UNIT);
    assert_eq!(request(&mut v, "c", UNIT), (Status::Blocked, ReasonCode::RateLimited));
    // a new UTC day resets the counter
    assert_eq!(request_at(&mut v, "d", UNIT, NOW + NS_PER_DAY).0, Status::TransferPending);
}

// ------------------------------------------------------------------ owner recovery

#[test]
fn owner_withdraw_sends_one_transfer() {
    let mut v = setup();
    set_ctx(owner(), 1, NOW);
    v.owner_withdraw(token(), U128(5 * UNIT), owner()).detach();
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].receiver_id, token());
    assert!(get_logs().iter().any(|l| l.contains("owner_withdraw")));
}

// ------------------------------------------------------------------ views

#[test]
fn list_requests_is_newest_first() {
    let mut v = setup();
    request(&mut v, "first", UNIT);
    request(&mut v, "second", 25 * UNIT);
    let ids: Vec<String> = v.list_requests(None, None).into_iter().map(|r| r.request_id).collect();
    assert_eq!(ids, vec!["second", "first"]);
    assert_eq!(v.list_requests(Some(1), Some(1))[0].request_id, "first");
}

// ------------------------------------------------------------------ digest test vector

/// Independent vector computed with Python's hashlib (recorded in docs/INTEGRATIONS.md). The TS
/// client in packages/shared checks the same bytes and hash.
#[test]
fn digest_matches_independent_test_vector() {
    let req = PaymentRequest {
        request_id: "req-001".into(),
        agent_id: agent(),
        route: Route::NearDirect,
        token: token(),
        amount: U128(25_000_000),
        recipient: api(),
        reason: "pay for weather API".into(),
        created_at_ns: U64(0),
        expires_at_ns: U64(1_762_000_000_000_000_000),
        policy_version: 1,
        cross_chain: None,
        request_hash: String::new(),
        status: Status::AwaitingApproval,
        reason_code: ReasonCode::RequiresOwnerApproval,
        approved_by: None,
        reserved_day: None,
        updated_at_ns: U64(0),
    };
    set_ctx(vault(), 0, NOW);
    let bytes = encode_request("sandbox", "vault.test.near", &req);
    assert_eq!(bytes.len(), 172);
    assert_eq!(
        request_hash("sandbox", "vault.test.near", &req),
        "2d4708a7e377bb80a417f78393fea4ac8c40e2a4a2710b0fc713971a7804186a"
    );
}

// ------------------------------------------------------------------ cross-chain route (P1)
//
// A 1Click route sends tokens to a quote's deposit account on NEAR; 1Click is trusted to deliver
// on the other chain. The vault binds the deposit account and the destination tuple into the hash
// the owner approves, enforces the quote's deadline and never auto-pays (AGENTS.md section 8).

const SOL: &str = "sol";
const SOL_USDC: &str = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const PAYEE: &str = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const QUOTE_HASH: &str = "6327245c3a45d3d9ea72b70fbb671926e7b80f63d311bfd73dde876d5df02b26";
/// The quote's deadline in these tests: 30 minutes after NOW, well inside the 1 hour approval TTL.
const QUOTE_DEADLINE: u64 = NOW + 1800 * NS_PER_SEC;
const MARGIN: u64 = QUOTE_SAFETY_MARGIN_SEC * NS_PER_SEC;

fn deposit() -> AccountId {
    acc("deposit.test.near")
}

fn xc_route() -> CrossChainRoute {
    CrossChainRoute {
        token: token(),
        destination_chain: SOL.into(),
        destination_asset: SOL_USDC.into(),
        recipients: vec![PAYEE.into()],
    }
}

fn xc_setup() -> Vault {
    set_ctx(vault(), 0, NOW);
    let mut p = policy();
    p.cross_chain = vec![xc_route()];
    Vault::new(owner(), vec![agent()], "sandbox".into(), p)
}

fn terms() -> CrossChainTerms {
    CrossChainTerms {
        destination_chain: SOL.into(),
        destination_asset: SOL_USDC.into(),
        destination_recipient: PAYEE.into(),
        refund_to: vault(),
        min_amount_out: U128(4_900_000),
        quote_hash: QUOTE_HASH.into(),
        quote_expires_at_ns: U64(QUOTE_DEADLINE),
    }
}

fn xc_request_with(
    v: &mut Vault,
    id: &str,
    amount: u128,
    deposit_account: AccountId,
    t: CrossChainTerms,
) -> PaymentOutcome {
    set_ctx(agent(), 0, NOW);
    v.request_cross_chain_payment(
        id.into(),
        token(),
        U128(amount),
        deposit_account,
        "pay invoice on solana".into(),
        t,
    )
}

fn xc_request(v: &mut Vault, id: &str, amount: u128) -> PaymentOutcome {
    xc_request_with(v, id, amount, deposit(), terms())
}

fn assert_blocked(o: &PaymentOutcome, code: ReasonCode) {
    assert_eq!((o.status, o.reason_code), (Status::Blocked, code));
    assert_eq!(o.request_hash, None);
}

#[test]
fn cross_chain_route_is_off_unless_the_policy_lists_it() {
    let mut v = setup();
    let o = xc_request(&mut v, "x1", 5 * UNIT);
    assert_blocked(&o, ReasonCode::RouteNotAllowed);
    assert!(v.get_request("x1".into()).is_none());
}

#[test]
fn t12_cross_chain_destination_must_be_allowlisted() {
    let mut v = xc_setup();
    let mut other_asset = terms();
    other_asset.destination_asset = "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near".into();
    assert_blocked(
        &xc_request_with(&mut v, "x1", 5 * UNIT, deposit(), other_asset),
        ReasonCode::RouteNotAllowed,
    );
    let mut other_chain = terms();
    other_chain.destination_chain = "eth".into();
    assert_blocked(
        &xc_request_with(&mut v, "x2", 5 * UNIT, deposit(), other_chain),
        ReasonCode::RouteNotAllowed,
    );
    let mut other_payee = terms();
    other_payee.destination_recipient = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin".into();
    assert_blocked(
        &xc_request_with(&mut v, "x3", 5 * UNIT, deposit(), other_payee),
        ReasonCode::RecipientNotAllowed,
    );
    // the route's limits are the token's limits
    assert_blocked(&xc_request(&mut v, "x4", 31 * UNIT), ReasonCode::HardCapExceeded);
    assert_eq!(v.get_config().request_count, 0, "blocked requests are not stored");
}

#[test]
fn t14_cross_chain_payment_waits_for_the_owner_even_under_the_auto_limit() {
    let mut v = xc_setup();
    // 1 TUSD is under the 10 TUSD auto limit, which only applies to direct NEAR payments
    let o = xc_request(&mut v, "x1", UNIT);
    assert_eq!((o.status, o.reason_code), (Status::AwaitingApproval, ReasonCode::RequiresOwnerApproval));
    assert!(get_created_receipts().is_empty(), "no transfer before the owner approves");
    let b = budget(&v, DAY);
    assert_eq!((b.pending.0, b.executed.0), (0, 0));
    assert_eq!(v.get_config().open_approvals, 1);
}

#[test]
fn t14_deposit_account_and_final_payee_are_stored_and_hashed_separately() {
    let mut v = xc_setup();
    xc_request(&mut v, "x1", 5 * UNIT);
    let stored = v.get_request("x1".into()).unwrap();
    assert_eq!(stored.route, Route::OneClickOriginNear);
    assert_eq!(stored.recipient, deposit(), "tokens go to the quote's deposit account on NEAR");
    let t = stored.cross_chain.clone().expect("cross-chain terms are stored");
    assert_eq!(t.destination_recipient, PAYEE, "the final payee is kept apart from the deposit account");
    assert_eq!(t.refund_to, vault());

    // every route term is in the hash the owner approves
    let hash = |f: &dyn Fn(&mut PaymentRequest)| {
        let mut r = stored.clone();
        f(&mut r);
        request_hash("sandbox", "vault.test.near", &r)
    };
    let mutations: [&dyn Fn(&mut PaymentRequest); 7] = [
        &|r| r.recipient = mallory(),
        &|r| {
            r.cross_chain.as_mut().unwrap().destination_recipient =
                "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin".into()
        },
        &|r| r.cross_chain.as_mut().unwrap().destination_asset = "nep141:other.near".into(),
        &|r| r.cross_chain.as_mut().unwrap().destination_chain = "eth".into(),
        &|r| r.cross_chain.as_mut().unwrap().min_amount_out = U128(1),
        &|r| r.cross_chain.as_mut().unwrap().quote_hash = "0".repeat(64),
        &|r| r.cross_chain.as_mut().unwrap().quote_expires_at_ns = U64(QUOTE_DEADLINE + 1),
    ];
    for m in mutations {
        assert_ne!(hash(m), stored.request_hash);
    }
    assert_eq!(approve(&mut v, "x1").status, Status::Approved);
}

#[test]
#[should_panic(expected = "HASH_MISMATCH")]
fn t14_approval_of_a_swapped_deposit_account_fails() {
    // The page showed a deposit account the agent (or a lying RPC) substituted.
    let mut v = xc_setup();
    xc_request(&mut v, "x1", 5 * UNIT);
    let mut shown = v.get_request("x1".into()).unwrap();
    shown.recipient = mallory();
    let shown_hash = request_hash("sandbox", "vault.test.near", &shown);
    set_ctx(owner(), 1, NOW);
    v.approve_request("x1".into(), shown_hash);
}

#[test]
#[should_panic(expected = "HASH_MISMATCH")]
fn t14_approval_of_a_swapped_final_payee_fails() {
    let mut v = xc_setup();
    xc_request(&mut v, "x1", 5 * UNIT);
    let mut shown = v.get_request("x1".into()).unwrap();
    shown.cross_chain.as_mut().unwrap().destination_recipient =
        "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin".into();
    let shown_hash = request_hash("sandbox", "vault.test.near", &shown);
    set_ctx(owner(), 1, NOW);
    v.approve_request("x1".into(), shown_hash);
}

#[test]
fn t14_quote_terms_that_could_redirect_funds_are_refused() {
    let mut v = xc_setup();
    let with = |f: fn(&mut CrossChainTerms)| {
        let mut t = terms();
        f(&mut t);
        t
    };
    let cases: Vec<(&str, AccountId, CrossChainTerms)> = vec![
        ("refund elsewhere", deposit(), with(|t| t.refund_to = "mallory.test.near".parse().unwrap())),
        ("deposit is the vault", vault(), terms()),
        ("deposit is the owner", owner(), terms()),
        ("deposit is the token", token(), terms()),
        ("deposit is the agent", agent(), terms()),
        ("no minimum output", deposit(), with(|t| t.min_amount_out = U128(0))),
        ("quote hash not sha256 hex", deposit(), with(|t| t.quote_hash = "XYZ".into())),
        ("uppercase quote hash", deposit(), with(|t| t.quote_hash = QUOTE_HASH.to_uppercase())),
        ("whitespace in payee", deposit(), with(|t| t.destination_recipient = format!(" {PAYEE}"))),
        ("look-alike payee", deposit(), with(|t| t.destination_recipient = PAYEE.replace('C', "\u{0421}"))),
        ("bad chain name", deposit(), with(|t| t.destination_chain = "Sol".into())),
    ];
    for (i, (what, dep, t)) in cases.into_iter().enumerate() {
        let o = xc_request_with(&mut v, &format!("bad{i}"), 5 * UNIT, dep, t);
        assert_eq!(o.reason_code, ReasonCode::InvalidQuote, "{what}");
        assert_eq!(o.status, Status::Blocked, "{what}");
    }
    assert_eq!(v.get_config().request_count, 0);
}

#[test]
fn t07_quote_too_close_to_its_deadline_is_refused() {
    let mut v = xc_setup();
    let mut t = terms();
    t.quote_expires_at_ns = U64(NOW + MARGIN);
    assert_blocked(&xc_request_with(&mut v, "x1", 5 * UNIT, deposit(), t), ReasonCode::QuoteExpired);
}

#[test]
fn cross_chain_request_expires_before_its_quote() {
    let mut v = xc_setup();
    xc_request(&mut v, "x1", 5 * UNIT);
    let r = v.get_request("x1".into()).unwrap();
    // the quote ends before the approval TTL would, so the request ends a margin before the quote
    assert_eq!(r.expires_at_ns.0, QUOTE_DEADLINE - MARGIN);
    assert!(r.expires_at_ns.0 < NOW + u64::from(TTL_SEC) * NS_PER_SEC);
}

#[test]
#[should_panic(expected = "QUOTE_EXPIRED")]
fn t07_expired_quote_cannot_be_approved() {
    let mut v = xc_setup();
    xc_request(&mut v, "x1", 5 * UNIT);
    let hash = v.get_request("x1".into()).unwrap().request_hash;
    set_ctx(owner(), 1, QUOTE_DEADLINE - MARGIN / 2);
    v.approve_request("x1".into(), hash);
}

#[test]
#[should_panic(expected = "QUOTE_EXPIRED")]
fn t07_expired_quote_cannot_execute() {
    let mut v = xc_setup();
    xc_request(&mut v, "x1", 5 * UNIT);
    approve(&mut v, "x1");
    set_ctx(agent(), 0, QUOTE_DEADLINE - MARGIN / 2);
    v.execute_request("x1".into()).detach();
}

#[test]
fn t13_cross_chain_deposit_stays_spent_whatever_happens_next() {
    let mut v = xc_setup();
    xc_request(&mut v, "x1", 5 * UNIT);
    approve(&mut v, "x1");
    set_ctx(agent(), 0, NOW);
    v.execute_request("x1".into()).detach();

    // exactly one ft_transfer, to the deposit account, never to the final payee
    let receipts = get_created_receipts();
    assert_eq!(receipts[0].receiver_id, token());
    match &receipts[0].actions[0] {
        MockAction::FunctionCallWeight { method_name, args, .. } => {
            assert_eq!(method_name, b"ft_transfer");
            let args: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(args).unwrap();
            assert_eq!(args["receiver_id"], "deposit.test.near");
            assert_eq!(args["amount"], (5 * UNIT).to_string());
        }
        other => panic!("unexpected action {other:?}"),
    }
    assert_eq!(budget(&v, DAY).pending.0, 5 * UNIT);

    let o = resolve(&mut v, "x1", true, NOW);
    assert_eq!((o.status, o.reason_code), (Status::CrossChainPending, ReasonCode::ExternalSettlementPending));
    let b = budget(&v, DAY);
    assert_eq!((b.pending.0, b.executed.0, b.available.0), (0, 5 * UNIT, 45 * UNIT));

    // Late or repeated callbacks, a failure report included, change nothing. No vault method takes
    // a 1Click status, so a reported refund has no way to restore budget either (I9).
    resolve(&mut v, "x1", false, NOW);
    resolve(&mut v, "x1", true, NOW);
    let b = budget(&v, DAY);
    assert_eq!((b.pending.0, b.executed.0, b.available.0), (0, 5 * UNIT, 45 * UNIT));
    assert_eq!(v.get_request("x1".into()).unwrap().status, Status::CrossChainPending);
    assert_eq!(v.get_config().open_approvals, 0);
}

#[test]
fn t08_failed_cross_chain_deposit_releases_its_reservation_once() {
    // A definitive on-chain failure (e.g. the deposit account is not registered with the token)
    // means the tokens never left, so the reservation is released, once.
    let mut v = xc_setup();
    xc_request(&mut v, "x1", 5 * UNIT);
    approve(&mut v, "x1");
    set_ctx(agent(), 0, NOW);
    v.execute_request("x1".into()).detach();
    let o = resolve(&mut v, "x1", false, NOW);
    assert_eq!((o.status, o.reason_code), (Status::TransferFailed, ReasonCode::SourceTransferFailed));
    resolve(&mut v, "x1", true, NOW);
    let b = budget(&v, DAY);
    assert_eq!((b.pending.0, b.executed.0, b.available.0), (0, 0, 50 * UNIT));
}

#[test]
fn policy_validation_rejects_unsafe_cross_chain_routes() {
    let v = vault();
    let with = |f: fn(&mut Policy)| {
        let mut p = policy();
        p.cross_chain = vec![xc_route()];
        f(&mut p);
        validate_policy(&p, &v)
    };
    assert!(with(|_| {}).is_ok());
    assert!(with(|p| p.cross_chain[0].token = "other.test.near".parse().unwrap()).is_err());
    assert!(with(|p| p.cross_chain[0].recipients.clear()).is_err());
    assert!(with(|p| p.cross_chain[0].recipients.push(PAYEE.into())).is_err());
    assert!(with(|p| p.cross_chain[0].recipients[0] = "has space".into()).is_err());
    assert!(with(|p| p.cross_chain[0].destination_chain = "SOL".into()).is_err());
    assert!(with(|p| p.cross_chain[0].destination_asset = String::new()).is_err());
    assert!(with(|p| p.cross_chain.push(xc_route())).is_err());
    assert!(with(|p| {
        for i in 0..MAX_CROSS_CHAIN_ROUTES {
            let mut r = xc_route();
            r.destination_asset = format!("nep141:asset-{i}.near");
            p.cross_chain.push(r);
        }
    })
    .is_err());
}

/// Independent vector computed with Python's hashlib (recorded in docs/INTEGRATIONS.md). The TS
/// client in packages/shared checks the same bytes and hash. Direct requests keep their old vector.
#[test]
fn digest_matches_independent_cross_chain_test_vector() {
    let req = PaymentRequest {
        request_id: "xc-001".into(),
        agent_id: agent(),
        route: Route::OneClickOriginNear,
        token: token(),
        amount: U128(5_000_000),
        recipient: deposit(),
        reason: "pay invoice 42 on solana".into(),
        created_at_ns: U64(0),
        expires_at_ns: U64(1_762_000_000_000_000_000),
        policy_version: 1,
        cross_chain: Some(CrossChainTerms {
            destination_chain: SOL.into(),
            destination_asset: SOL_USDC.into(),
            destination_recipient: PAYEE.into(),
            refund_to: vault(),
            min_amount_out: U128(4_900_000),
            quote_hash: QUOTE_HASH.into(),
            quote_expires_at_ns: U64(1_762_000_600_000_000_000),
        }),
        request_hash: String::new(),
        status: Status::AwaitingApproval,
        reason_code: ReasonCode::RequiresOwnerApproval,
        approved_by: None,
        reserved_day: None,
        updated_at_ns: U64(0),
    };
    set_ctx(vault(), 0, NOW);
    let bytes = encode_request("sandbox", "vault.test.near", &req);
    assert_eq!(bytes.len(), 410);
    assert_eq!(
        request_hash("sandbox", "vault.test.near", &req),
        "04940b54db8f43847767b0169b57a67f80ec6e8851fe470516c72a3c178bebb2"
    );
}
