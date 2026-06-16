import { useState } from "react";
import { TOY_CONSTANTS as C, spIntervalIters } from "../sim/constants.ts";
import { POS } from "../sim/proofofspace.ts";
import { Tex } from "./Math.tsx";

function F({ label, expr }: { label: string; expr: string }) {
  return (
    <div style={{ margin: "10px 0" }}>
      <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 2 }}>{label}</div>
      <Tex expr={expr} block />
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <table className="spec-table">
      <thead>
        <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className={head.length === 3 && j === 1 ? "mini" : head.length === 3 && j === 2 ? "real" : ""}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const MIN = C.MIN_BLOCKS_PER_CHALLENGE_BLOCK;
const SPI = Number(spIntervalIters(C));

interface Topic {
  title: string;
  body: React.ReactNode;
}

const TOPICS: Topic[] = [
  {
    title: "Mini PoST vs. real Chia",
    body: (
      <>
        <p>Same structure and formulas as mainnet; only the magnitudes are scaled down so the whole consensus dance fits on screen and runs instantly.</p>
        <Table
          head={["Parameter", "Mini PoST", "Real Chia (mainnet)"]}
          rows={[
            ["Signage points / sub-slot", String(C.NUM_SPS_SUB_SLOT), "64"],
            ["Extra SP intervals (overflow)", String(C.NUM_SP_INTERVALS_EXTRA), "3"],
            ["Sub-slot iterations", Number(C.SUB_SLOT_ITERS).toLocaleString(), "2²⁷ ≈ 134,217,728"],
            ["SP interval iterations", SPI.toLocaleString(), "2²¹ ≈ 2,097,152"],
            ["Sub-slot target time", "— (instant)", "600 s (10 min)"],
            ["Min blocks / challenge block", String(MIN), "16"],
            ["Slot blocks target", String(C.SLOT_BLOCKS_TARGET), "32"],
            ["Max sub-slot blocks", String(C.MAX_SUB_SLOT_BLOCKS), "128"],
            ["Plot size (k)", String(C.K), "32 (mainnet min)"],
            ["Plot filter zero bits", String(C.NUMBER_ZERO_BITS_PLOT_FILTER), "9 (V1)"],
            ["Difficulty constant factor", "2²⁰", "2⁶⁷"],
            ["Plots / farmers", `${16} / ${4}`, "millions, globally"],
            ["VDF group", "class group, 64-bit disc.", "class group, 1024-bit disc."],
            ["VDF proof", "n-wesolowski (3 seg.)", "n-wesolowski"],
            ["Sub-epoch / epoch blocks", "— (not modeled)", "384 / 4,608"],
          ]}
        />
      </>
    ),
  },
  {
    title: "VDF output vs. challenge",
    body: (
      <>
        <p>The “Time” in Proof of Space and <i>Time</i> is a VDF: <code>y = g^(2^T)</code> by T sequential squarings in a class group. Two things are easy to confuse:</p>
        <Table
          head={["Term", "What it is"]}
          rows={[
            [<b style={{ color: "var(--cc)" }}>VDF output</b>, "A class-group element — a binary quadratic form (a, b, c). The result of the squarings."],
            [<b>VDFInfo</b>, <>The struct a block stores: <code>{"{ challenge, number_of_iterations, output }"}</code>. <code>output</code> is the element above.</>],
            [<b>challenge</b>, <>A 32-byte value that seeds a VDF. The next sub-slot’s challenge is <code>c(n+1) = H(ChallengeChainSubSlot)</code> — a hash of a structure that embeds the VDF outputs.</>],
          ]}
        />
        <p><b>“A block infuses the hash of what?”</b> A block holds VDFInfo structs (with the output <i>element</i>). The value that seeds the next sub-slot is a <b>hash of the ChallengeChainSubSlot structure</b> — which contains those outputs plus the ICC hash. So it is a hash <i>of a struct that contains the outputs</i>; not the raw output, and not a bare hash of a single output.</p>
      </>
    ),
  },
  {
    title: "Farmer wins a block",
    body: (
      <>
        <p>Every signage point, a farmer scans its plots. A block exists only because a plot cleared all of these gates:</p>
        <Table
          head={["Step", "What happens"]}
          rows={[
            ["1. plot filter", <>H(plot_id ‖ challenge ‖ sp_output) must have ≥ {C.NUMBER_ZERO_BITS_PLOT_FILTER} leading zero bits — only ~1/2<sup>{C.NUMBER_ZERO_BITS_PLOT_FILTER}</sup> of plots pass per signage point.</>],
            ["2. quality", <>the (passing) plot finds its <b>proof of space</b> for the challenge — a real 7-table lookup — and the proof yields a quality string (see <b>🧬 proof of space</b>).</>],
            ["3. required_iters", <><code>required_iters = difficulty · 2²⁰ · H(quality ‖ sp) / (2²⁵⁶ · plot_size)</code>.</>],
            ["4. win?", <>the plot wins only if <code>required_iters &lt; sp_interval_iters = {SPI}</code> (it fits inside one signage-point window).</>],
            ["5. sign", "the harvester and farmer each sign the signage point with their half of the plot key; the halves aggregate into one BLS plot signature, verified against the aggregate plot_pk."],
          ]}
        />
        <p>The keys are <b>real BLS12-381</b>. The blocks on the timeline are earned: each one passed the filter, won its window, and carries a verified signature (see a block’s panel).</p>
        <p><b>It’s all leading zeros.</b> The filter needs leading zero <i>bits</i>; and a small quality (also leading zeros) is what makes <code>required_iters</code> tiny enough to win. Open <b>🔍 plot scan</b> (top controls) to watch every plot at a signage point: which clear the filter, and of those, whose quality lands inside the window.</p>
      </>
    ),
  },
  {
    title: "Proof of space (7 tables)",
    body: (
      <>
        <p>A plot is 7 tables built by forward propagation (chiapos, "Beyond Hellman"). It is the storage that the time-memory tradeoff is about — you keep the tables so you can answer challenges cheaply.</p>
        <Table
          head={["Step", "What happens"]}
          rows={[
            ["F1", <>each x in [0, 2<sup>{POS.K}</sup>) gets an f-value <code>f1(x)</code> from the plot_id.</>],
            ["matching", <>two entries combine into a table-(t+1) entry only if they sit in <b>adjacent buckets</b> and satisfy a quadratic condition <code>(2m+parity)²</code> — the real chiapos match function.</>],
            ["Fx", "the matched pair hashes into the next table's f-value; the new entry stores back-pointers to its two children."],
            ["proof", <>for a challenge, a table-7 entry whose top {POS.K} bits match it is found; following its back-pointers down 6 levels gives <b>64 leaf x-values</b> (a binary tree).</>],
            ["verify", "re-propagate the 64 leaves up, re-checking every match, and confirm the root matches the challenge."],
            ["quality", "the quality = H(challenge ‖ two of the 64 leaves), chosen by the challenge bits."],
          ]}
        />
        <p>Real chiapos uses ChaCha8 / BLAKE3 and constants tuned for k≥18; here F1/Fx are SHA-256 and the constants are scaled so the forest actually works at <b>k={POS.K}</b> — which is the whole reason we chose k=8: open <b>🧬 proof of space</b> on any block to see its 64-leaf tree.</p>
      </>
    ),
  },
  {
    title: "Buckets & matching",
    body: (
      <>
        <p>
          Matching has to be cheap. Comparing every pair of entries in a table would be O(N²). Instead the f-value
          space is sliced into fixed-size <b>buckets</b>, an entry may only match entries in the <b>next</b> bucket, and
          the table is kept sorted by y — so matching is a linear neighbour scan, not all-pairs.
        </p>
        <F label={`bucket of an f-value (each spans k_BC = ${POS.BC} consecutive f-values)`} expr={`\\mathrm{bk}(y)=\\big\\lfloor y / ${POS.BC} \\big\\rfloor`} />
        <F label="an entry's position inside its bucket"
          expr={`b(y)=\\Big\\lfloor \\tfrac{y \\bmod ${POS.BC}}{${POS.C}} \\Big\\rfloor \\in [0,${POS.B}), \\qquad c(y)=(y \\bmod ${POS.BC}) \\bmod ${POS.C} \\in [0,${POS.C})`} />
        <F label="match: ONLY adjacent buckets, plus the quadratic on (b,c)"
          expr={`\\mathrm{bk}(y_R)=\\mathrm{bk}(y_L)+1 \\ \\wedge\\ \\exists m: \\ b_R=(b_L{+}m)\\bmod ${POS.B},\\ c_R=((2m{+}\\pi)^2{+}c_L)\\bmod ${POS.C}`} />
        <Table
          head={["Term", "Meaning"]}
          rows={[
            ["bucket", <>a contiguous block of <code>{POS.BC}</code> consecutive f-values. Sorting by y lines the buckets up in order.</>],
            ["why adjacent only", "restricting matches to bucket b → b+1 is what makes plotting feasible: scan neighbouring buckets instead of comparing everything."],
            [<>(b, c)</>, "where an entry sits inside its bucket. The match ties the right entry's (b,c) to the left's by an offset m and the square (2m+π)²."],
            [<>π (parity)</>, <><code>​{"bk(y_L) mod 2"}</code> — flips the quadratic from bucket to bucket so the matches aren't trivially predictable. This square is the “Beyond Hellman” ingredient.</>],
          ]}
        />
        <p>In the <b>🌳 plot</b> view the faint vertical ticks are bucket boundaries; hover a cell to light its bucket and the bucket above, and see the matches that cross between them.</p>
      </>
    ),
  },
  {
    title: "What a block holds",
    body: (
      <>
        <p>A full block is a reward-chain trunk plus a farmer-signed foliage:</p>
        <Table
          head={["Field", "Contents"]}
          rows={[
            ["reward_chain_block", "height, weight, total_iters, signage_point_index, proof_of_space, is_transaction_block, and the VDFInfos below"],
            [<span style={{ color: "var(--cc)" }}>challenge_chain_sp_vdf / _ip_vdf</span>, "VDFInfo on the challenge chain (signage & infusion points)"],
            [<span style={{ color: "var(--rc)" }}>reward_chain_sp_vdf / _ip_vdf</span>, "VDFInfo on the reward chain"],
            [<span style={{ color: "var(--icc)" }}>infused_challenge_chain_ip_vdf</span>, <>VDFInfo on the infused challenge chain — present only while <code>deficit &lt; {MIN - 1}</code></>],
            ["challenge_chain_sp_signature, reward_chain_sp_signature", "plot-key signatures over the signage-point outputs"],
            ["foliage", "prev_block_hash, reward_block_hash, pool_target (+ pool signature), farmer_reward_puzzle_hash"],
            ["foliage_transaction_block", "(transaction blocks only) prev_transaction_block_hash, timestamp, additions/removals roots"],
          ]}
        />
      </>
    ),
  },
  {
    title: "The puzzle / lock",
    body: (
      <>
        <p>A block can only be produced by the winning farmer, and it is bound to that farmer's exact reward. Nested signatures enforce it — change anything and a signature fails to verify.</p>
        <Table
          head={["Lock", "What it binds / who can open it"]}
          rows={[
            ["proof of space", "only a plot whose PoS qualifies for the cc signage point can attempt — you need the stored plot (plot_id)."],
            [<>plot key <Tex expr={"=\\mathrm{local\\_pk}\\oplus\\mathrm{farmer\\_pk}"} /></>, "harvester + farmer each hold half of the secret; together they sign. Only they can."],
            ["cc_sp / rc_sp signatures", "the plot key signs the signage-point outputs — proves the winner answered THIS challenge at THIS signage point."],
            ["foliage signature", "the plot key signs H(foliage_block_data) — binds pool_target, farmer_reward_puzzle_hash, extension_data. You can't change the reward address without re-signing."],
            ["pool signature", "the pool key signs the pool_target — binds the block's reward share to the pool."],
          ]}
        />
        <p>Open <b>🔒 puzzle</b> and hit tamper: rewriting the reward address leaves the plot-key signature (made over the original foliage) failing to verify, and forging a new one needs <code>plot_sk</code> — which only the real farmer has.</p>
      </>
    ),
  },
  {
    title: "BLS12-381 — the curve",
    body: (
      <>
        <p>Every key and signature in Chia — and in this app (real <code>@noble/curves</code>) — lives on <b>BLS12-381</b>, a <b>pairing-friendly</b> elliptic curve. “Pairing-friendly” is the whole point: it carries an efficient <b>bilinear map</b>, and that map is what makes signature <i>aggregation</i> possible.</p>

        <h3 style={{ color: "var(--cc)", fontSize: 13, margin: "10px 0 0" }}>How it's built</h3>
        <p>It is a Barreto–Lynn–Scott construction with <b>embedding degree 12</b>, generated from a single low-weight integer seed <Tex expr={"z = \\texttt{-0xd201000000010000}"} /> (low Hamming weight → fast field arithmetic). Everything else is a polynomial in <Tex expr={"z"} />:</p>
        <F label="base field prime p (381 bits)" expr={"p = \\tfrac{1}{3}(z-1)^2\\,(z^4 - z^2 + 1) + z"} />
        <F label="subgroup / scalar order r (255-bit prime) — the order of G1, G2, GT" expr={"r = z^4 - z^2 + 1"} />
        <F label="the curve, over the base field" expr={"E/\\mathbb{F}_p:\\; y^2 = x^3 + 4"} />

        <h3 style={{ color: "var(--cc)", fontSize: 13, margin: "14px 0 0" }}>Three groups + a pairing</h3>
        <Table
          head={["Group", "Lives in", "In Chia"]}
          rows={[
            [<b style={{ color: "var(--cc)" }}>G1</b>, <>order-<code>r</code> subgroup of <Tex expr={"E(\\mathbb{F}_p)"} /></>, <><b>public keys</b> — compress to <b>48 bytes</b></>],
            [<b style={{ color: "var(--rc)" }}>G2</b>, <>subgroup of <Tex expr={"E'(\\mathbb{F}_{p^2})"} /> (a twist)</>, <><b>signatures</b> — compress to <b>96 bytes</b></>],
            [<b style={{ color: "var(--icc)" }}>GT</b>, <>order-<code>r</code> subgroup of <Tex expr={"\\mathbb{F}_{p^{12}}^{*}"} /></>, "the pairing's target — never serialized"],
          ]}
        />
        <F label="the bilinear pairing (non-degenerate)" expr={"e:\\; G_1 \\times G_2 \\to G_T, \\qquad e(aP,\\,bQ) = e(P,Q)^{ab}"} />
        <p>That one identity — sliding scalars in and out of both arguments — is what every BLS trick rests on. The 381-bit field is sized so the discrete log in <Tex expr={"\\mathbb{F}_{p^{12}}"} /> still costs ≈ <b>128-bit</b> security.</p>
        <p>Public keys sit in the <i>smaller</i> group G1 (the “min-pubkey” variant), and messages are hashed <i>into</i> G2 with SHA-256 + SSWU (the IETF hash-to-curve) — so a signature is a single G2 point.</p>
      </>
    ),
  },
  {
    title: "BLS signatures",
    body: (
      <>
        <p>A BLS signature is one curve point. The whole scheme is scalar multiplication on the two sides of the pairing:</p>
        <F label="key — secret scalar, public point in G1" expr={"\\mathrm{sk}\\in[1,r),\\qquad \\mathrm{pk} = \\mathrm{sk}\\cdot g_1"} />
        <F label="sign — scale the message's G2 point by the secret" expr={"\\sigma = \\mathrm{sk}\\cdot H(m)\\in G_2"} />
        <F label="verify — one pairing equation" expr={"e(g_1,\\;\\sigma) \\;=\\; e(\\mathrm{pk},\\;H(m))"} />
        <p>It checks out by bilinearity: <Tex expr={"e(g_1,\\, \\mathrm{sk}\\cdot H(m)) = e(\\mathrm{sk}\\cdot g_1,\\, H(m)) = e(\\mathrm{pk},\\, H(m))"} />. No per-signature randomness is involved — signatures are <b>deterministic</b>, so there is no ECDSA-style nonce-reuse footgun.</p>

        <h3 style={{ color: "var(--cc)", fontSize: 13, margin: "12px 0 0" }}>What that buys you</h3>
        <Table
          head={["Capability", "How / why"]}
          rows={[
            [<b>Aggregation</b>, <>signatures and keys are points, so they <b>add</b>: <Tex expr={"\\sigma_{\\text{agg}}=\\textstyle\\sum_i \\sigma_i,\\; \\mathrm{pk}_{\\text{agg}}=\\sum_i \\mathrm{pk}_i"} />. One point verifies <i>many</i> signers — a whole block (and far beyond) checks in O(1).</>],
            [<b>Rogue-key safety</b>, <>naive sums are forgeable with a crafted “rogue” key. Chia signs the <b>augmented</b> message <Tex expr={"H(\\mathrm{pk}\\,\\Vert\\,m)"} />, binding each signer to its own key — no proof-of-possession round needed.</>],
            [<b>HD derivation</b>, <>EIP-2333: a master key from a 24-word seed, child keys by index → all of a wallet's farmer / pool / spend keys come deterministically from one seed.</>],
            [<><b>Hardened</b> children</>, <>derived <i>from the parent secret</i>; the child pubkey can <b>not</b> be recomputed from the parent pubkey. A leaked child secret can't expose its siblings or parent — the price is no watch-only.</>],
            [<><b>Unhardened</b> children</>, <>derived with point arithmetic, so the child <b>pubkey</b> follows from the parent <b>pubkey</b> alone. A cold / observer wallet can mint an endless tree of receive keys with no secret present (caveat: parent pub + one child secret recovers the parent secret).</>],
            [<>Synthetic / <b>taproot</b> keys</>, <>a coin can lock to <Tex expr={"\\mathrm{pk}_{\\text{syn}} = \\mathrm{pk} + H(\\mathrm{pk}\\,\\Vert\\,\\text{hidden})\\cdot g_1"} />, hiding an alternate spend path while the owner still signs with the matching <Tex expr={"\\mathrm{sk}_{\\text{syn}}"} />.</>],
          ]}
        />
        <p>In this app the <b>plot key</b> is exactly such an aggregate: <Tex expr={"\\mathrm{plot\\_pk} = \\mathrm{local\\_pk} + \\mathrm{farmer\\_pk}"} /> (the ⊕ in <b>🔒 puzzle</b>). The harvester and farmer each sign with their half; the halves <i>add</i> into one signature that verifies against <code>plot_pk</code>. The pool key signs the pool target separately. All of it is real BLS12-381 from <code>@noble/curves</code>.</p>
      </>
    ),
  },
  {
    title: "The three chains",
    body: (
      <Table
        head={["Chain", "Role"]}
        rows={[
          [<b style={{ color: "var(--cc)" }}>Challenge chain (cc)</b>, "Always runs. One VDF per sub-slot. Its signage-point output is the proof-of-space challenge. Combined with the ICC at slot end to form the next challenge."],
          [<b style={{ color: "var(--icc)" }}>Infused challenge chain (ic)</b>, <>Runs only while <code>deficit &lt; {MIN - 1}</code>. Starts at the challenge block, is infused by each later block, and folds into the cc challenge when the deficit hits 0.</>],
          [<b style={{ color: "var(--rc)" }}>Reward chain (rc)</b>, "Always runs. Infuses every block (the rc is the chain of blocks). Tracks weight and rewards."],
        ]}
      />
    ),
  },
  {
    title: "Deficit & the ICC",
    body: (
      <>
        <p>The deficit controls when the infused challenge chain runs and when it folds back into the challenge chain.</p>
        <Table
          head={["Rule", "Behaviour"]}
          rows={[
            ["start", <>A challenge block has <code>deficit = MIN − 1 = {MIN - 1}</code> (mainnet: 15).</>],
            ["each block", "decrements the deficit by 1."],
            ["ICC runs", <>while <code>deficit &lt; {MIN - 1}</code> — i.e. from the challenge block until it closes.</>],
            ["ICC closes", "when the deficit reaches 0; at the next sub-slot end its output folds into the cc challenge."],
            ["reset", "the deficit resets at sub-slot boundaries once it has reached 0."],
          ]}
        />
      </>
    ),
  },
  {
    title: "Transaction blocks",
    body: (
      <>
        <p>Not every block carries transactions. There are <b>two chains</b>: every block links to the previous one, but only transaction blocks link to the previous <i>transaction</i> block.</p>
        <Table
          head={["Rule / field", "Meaning"]}
          rows={[
            [<>is a tx block?</>, <>iff its <b>signage-point</b> total_iters exceeds the previous tx block's <b>infusion-point</b> total_iters: <Tex expr={"\\text{total}_{sp}(\\text{new}) > \\text{total}_{ip}(\\text{prev tx})"} />. Genesis is always one. The sp↔ip gap (3 intervals) spaces tx blocks out.</>],
            ["prev_block_hash", "every block has it — the block chain (consensus trunk)."],
            ["prev_transaction_block_hash", "only tx blocks — the sparser transaction chain, skipping the non-tx blocks."],
            ["foliage_transaction_block", "tx blocks only: timestamp, additions_root, removals_root, and the prev_transaction_block_hash. Signed by a 3rd plot-key signature."],
            ["transactions_info", "fees, cost, the aggregated spend signature, and reward_claims_incorporated."],
            ["reward claims", "a tx block settles the block rewards of every block since the previous tx block (including the non-tx ones) — so rewards are paid in the next tx block."],
          ]}
        />
        <p>See it in <b>💸 tx blocks</b>: the green rail is every block, the gold rail is the tx blocks; the same arcs appear on the main timeline.</p>
      </>
    ),
  },
  {
    title: "Signage & infusion points",
    body: (
      <Table
        head={["Term", "Meaning"]}
        rows={[
          ["signage point (sp)", <>One of {C.NUM_SPS_SUB_SLOT} per sub-slot, every <code>sp_interval_iters = {SPI}</code>. Where a farmer reads the challenge and tests plots. A proof wins only if <code>required_iters &lt; sp_interval_iters</code>.</>],
          ["infusion point (ip)", <>Where a winning block is folded in: <code>ip_iters = sp_iters + {C.NUM_SP_INTERVALS_EXTRA}·sp_interval_iters + required_iters (mod sub_slot_iters)</code>.</>],
          ["overflow block", <>A block whose sp is in the last {C.NUM_SP_INTERVALS_EXTRA} signage points; its infusion wraps into the next sub-slot.</>],
        ]}
      />
    ),
  },
  {
    title: "Key formulas",
    body: (
      <>
        <p>The real expressions, with this app's toy constants substituted (k={POS.K}, k<sub>BC</sub>={POS.BC}, k<sub>B</sub>={POS.B}, k<sub>C</sub>={POS.C}, sub-slot iters={Number(C.SUB_SLOT_ITERS)}, interval={SPI}).</p>

        <h3 style={{ color: "var(--cc)", fontSize: 13, margin: "10px 0 0" }}>Proof of space</h3>
        <F label={`F1 — first table (c=${POS.F_BITS - POS.EXTRA_BITS}, e=${POS.EXTRA_BITS} bits)`}
          expr={`f_1(x) = \\big(H(\\mathrm{id}\\,\\Vert\\,x)\\bmod 2^{${POS.F_BITS - POS.EXTRA_BITS}}\\big)\\cdot 2^{${POS.EXTRA_BITS}} + \\big\\lfloor x / 2^{${POS.K - POS.EXTRA_BITS}}\\big\\rfloor`} />
        <F label="buckets of an f-value"
          expr={`\\mathrm{bk}(y)=\\Big\\lfloor \\tfrac{y}{${POS.BC}}\\Big\\rfloor,\\quad b(y)=\\Big\\lfloor \\tfrac{y\\bmod ${POS.BC}}{${POS.C}}\\Big\\rfloor,\\quad c(y)=(y\\bmod ${POS.BC})\\bmod ${POS.C}`} />
        <F label="matching condition (adjacent buckets + quadratic)"
          expr={`\\mathrm{match}(y_L,y_R)\\iff \\mathrm{bk}(y_R)=\\mathrm{bk}(y_L)+1\\ \\wedge\\ \\exists\\,m\\in[0,${POS.EXTRA_POW}):\\ \\begin{cases} b_R-b_L\\equiv m \\!\\!\\pmod{${POS.B}}\\\\ c_R-c_L\\equiv (2m+\\pi)^2 \\!\\!\\pmod{${POS.C}}\\end{cases}`} />
        <F label="Fx — next table's f-value (top F_BITS of the hash)"
          expr={`f_x(t,y_L,y_R)=\\big\\lfloor H(t\\Vert y_L\\Vert y_R)\\big\\rfloor_{\\text{top }${POS.F_BITS}}`} />
        <F label="quality — from two of the 64 leaf x-values"
          expr={`Q = H(\\mathrm{challenge} \\Vert x_i \\Vert x_{i+1})`} />

        <h3 style={{ color: "var(--cc)", fontSize: 13, margin: "14px 0 0" }}>Winning a signage point</h3>
        <F label={`required_iters (difficulty Δ, DCF=2^20, plot size S_k=(2k+1)2^{k-1}=${Number((2n * BigInt(POS.K) + 1n) * (1n << BigInt(POS.K - 1)))})`}
          expr={`r = \\left\\lfloor \\frac{\\Delta \\cdot 2^{20} \\cdot H(Q \\Vert \\mathrm{sp})}{2^{256}\\cdot ${Number((2n * BigInt(POS.K) + 1n) * (1n << BigInt(POS.K - 1)))}} \\right\\rfloor, \\qquad \\text{win} \\iff r < ${SPI}`} />
        <F label="infusion point (the +3 intervals is the overflow grace)"
          expr={`\\mathrm{ip} = \\big(\\mathrm{sp\\_iters} + ${C.NUM_SP_INTERVALS_EXTRA}\\cdot ${SPI} + r\\big) \\bmod ${Number(C.SUB_SLOT_ITERS)}`} />

        <h3 style={{ color: "var(--cc)", fontSize: 13, margin: "14px 0 0" }}>Time (VDF) &amp; chaining</h3>
        <F label="class-group VDF — T sequential squarings"
          expr={`y = g^{\\,2^{T}} \\in \\mathrm{Cl}(\\Delta)`} />
        <F label="n-wesolowski proof (verifier checks this in O(1))"
          expr={`\\pi^{\\ell}\\cdot g^{\\,r} = y, \\qquad r = 2^{T} \\bmod \\ell`} />
        <F label="next sub-slot challenge folds in the ICC"
          expr={`c_{n+1} = H(\\text{cc\\_end} \\Vert \\text{icc\\_end})`} />
      </>
    ),
  },
  {
    title: "Reading the timeline",
    body: (
      <Table
        head={["Symbol", "Meaning"]}
        rows={[
          ["⊗", "a VDF point (signage sp or infusion ip). Faint = no block; coloured = won a block."],
          ["coloured Bn box", "a block on the rewards chain."],
          ["cc Bn box", "the challenge block — the ICC anchor."],
          ["solid arrow", "direct dependency. ICC running: block → icc → cc sp. ICC idle: block → cc sp."],
          ["dashed arrow", "the block infusing forward into cc ip."],
          ["dashed slot-change line", "the upcoming sub-slot boundary; amber when the ICC folds in there."],
        ]}
      />
    ),
  },
];

export function Textbook({ onClose, initial = 0 }: { onClose: () => void; initial?: number }) {
  const [i, setI] = useState(initial);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal book" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="book-body">
          <nav className="book-index">
            <h2>Textbook</h2>
            {TOPICS.map((t, idx) => (
              <button key={t.title} className={idx === i ? "active" : ""} onClick={() => setI(idx)}>
                {t.title}
              </button>
            ))}
          </nav>
          <div className="book-content">
            <h2>{TOPICS[i].title}</h2>
            {TOPICS[i].body}
          </div>
        </div>
      </div>
    </div>
  );
}
