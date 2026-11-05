# Demo post on X (draft)

Draft for the @spactvault account. **Nothing here has been posted.** The owner posts it, attaches the demo video or screenshots, and shares the post's link, which becomes `demoUrl` in the submission (HACKATHON.md).

Before posting, check:
- the demo video is attached (HACKATHON.md accepts a video or screenshots; Q-012 says screenshots are not enough when judges cannot open the demo, so a video is the safe choice);
- the text says it was built at NEAR HACKATHON and tags @NEARProtocol and #NEARHackathon (HACKATHON.md requires both);
- the optional tags: HACKATHON.md names @NearLegion and @NearBuilders. These drafts use @NearBuilders and @NEAR_hckthn as the owner asked; @NEAR_hckthn is not in HACKATHON.md, so check that the account exists, or swap it for @NearLegion (same length);
- the video shows one complete moment, from a real user action to a visible result (HACKATHON.md "A good demo post"). The cut from 2026-11-05 (1:40, captions and a voiceover, kept out of the repository) does: the agent asks for 1 USDC to Base, the owner approves in their NEAR wallet, the USDC arrives on Base, and a 5 USDC request is refused (STATUS "Second mainnet cross-chain run");
- both links open: https://spactvault.xyz and https://github.com/0xileri/SpactVault.

## Short version (276 of 280)

Counted the way X counts: each link is 23 characters, whatever its length.

```text
an ai agent shouldn't hold your wallet key.

built at NEAR HACKATHON #NEARHackathon @NEARProtocol @NearBuilders @NEAR_hckthn: a NEAR contract holds the money and rules. the agent only asks.

spactvault.xyz
github.com/0xileri/SpactVault

what would you let it spend unasked?
```

## Long version

For a long post (or a thread: split at the blank lines).

```text
giving an ai agent your wallet key is like giving a new hire the company card with no limit. the key can sign anything, so the only thing between the agent and your money is a prompt.

spactvault moves the rules out of the prompt and into a contract. we built it at NEAR HACKATHON.

what NEAR does here:
- the money sits in a NEAR contract with no access keys. nobody can change its code, us included.
- the agent's only key is a NEAR function-call key for three vault methods. it can ask the vault to pay. it can't move a single token itself.
- small payments go through at once. bigger ones wait until the owner approves that exact payment in their wallet. anything over the cap is refused on chain.
- payments to other chains go through NEAR Intents 1Click, and they always wait for the owner.

the video is a real run on mainnet, nov 5: the agent asked for 1 USDC to our address on Base. the vault held it, we approved it in a NEAR wallet, and 0.997398 USDC landed on Base in under 40 seconds. then it asked for 5 USDC, over the cap, and the contract refused it on chain. every transaction is linked from the repo.

the attacks we could think of (a lying backend, a prompt-injected agent, replays, parallel requests) run as tests against a real NEAR node, and the results are on the site.

unaudited prototype, so small amounts only.

https://spactvault.xyz
https://github.com/0xileri/SpactVault

@NEARProtocol #NEARHackathon @NearBuilders @NEAR_hckthn

the question we keep coming back to: what's the right default limit for an agent you didn't write yourself?
```
