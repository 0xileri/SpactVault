//! Starts a local NEAR sandbox with a funded Spact vault, then waits until interrupted.
//!
//! Usage: `demo-sandbox <fixture.json>`
//!
//! Writes the RPC address, contract ids and the sandbox owner and agent keys to the fixture file
//! (mode 0600) for the local dev signer and the browser tests. These keys exist only on this
//! throwaway local chain.

use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;

use anyhow::Context;
use integration_tests::{setup, AGENT_METHODS, SOL_PAYEE, UNIT};
use near_workspaces::types::NearToken;
use serde_json::json;
use tokio::signal::unix::{signal, SignalKind};

const DEMO_REQUEST: &str = "demo-approve-1";
const CROSS_CHAIN_REQUEST: &str = "demo-cross-chain-1";
/// Six hours: the demo's cross-chain quote outlives any local session or browser test run.
const QUOTE_LIFETIME_NS: u64 = 6 * 3600 * 1_000_000_000;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let path = std::env::args().nth(1).context("usage: demo-sandbox <fixture.json>")?;

    let env = setup().await?;
    // The owner allowlists one 1Click route, and the agent files one cross-chain request through it
    // (P1) before its key is restricted: the restricted key cannot call request_cross_chain_payment.
    env.enable_cross_chain().await?;
    let deposit = env.deposit_account("deposit").await?;
    let quote_deadline = env.now_ns().await? + QUOTE_LIFETIME_NS;
    env.request_cross_chain(
        &env.agent,
        CROSS_CHAIN_REQUEST,
        5 * UNIT,
        deposit.id(),
        SOL_PAYEE,
        quote_deadline,
    )
    .await?
    .into_result()?;
    // The agent keeps only a function-call key for two vault methods (see AGENTS.md I1).
    let agent = env.restrict_agent_key(NearToken::from_near(1)).await?;
    // One payment the policy settled on its own, and one waiting for the owner.
    env.request_signed(&agent, "demo-auto-1", 3 * UNIT, env.api.id(), "Weather API: 1,000 calls")
        .await?
        .into_result()?;
    env.request_signed(&agent, DEMO_REQUEST, 25 * UNIT, env.api.id(), "Weather API: monthly plan upgrade")
        .await?
        .into_result()?;

    let fixture = json!({
        "warning": "sandbox-only keys for a throwaway local chain; never reuse",
        "network": "sandbox",
        "rpc_url": env.worker.rpc_addr(),
        "vault_id": env.vault.id(),
        "token_id": env.token.id(),
        "owner_id": env.owner.id(),
        "owner_secret_key": env.owner.secret_key().to_string(),
        "agent_id": agent.id(),
        "agent_secret_key": agent.secret_key().to_string(),
        "agent_key": format!("function-call key: {} on {}, 1 NEAR gas allowance", AGENT_METHODS.join(", "), env.vault.id()),
        "api_id": env.api.id(),
        "mallory_id": env.mallory.id(),
        "demo_request_id": DEMO_REQUEST,
        "cross_chain_request_id": CROSS_CHAIN_REQUEST,
        "deposit_id": deposit.id(),
        "cross_chain_payee": SOL_PAYEE,
    });
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&path)
        .with_context(|| format!("cannot write {path}"))?;
    file.write_all(serde_json::to_string_pretty(&fixture)?.as_bytes())?;
    drop(file);

    eprintln!("sandbox RPC {} | vault {} | fixture {path}", env.worker.rpc_addr(), env.vault.id());
    println!("READY");

    // Keep the worker (and the sandbox node it owns) alive until SIGINT or SIGTERM.
    let mut term = signal(SignalKind::terminate())?;
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = term.recv() => {}
    }
    eprintln!("stopping sandbox");
    Ok(())
}
