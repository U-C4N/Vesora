# Vesora Denge: conservative communicating vessels

This implements the accepted Denge direction as a reusable, renderer-independent model in `packages/core/src/balance.ts`. It is an opt-in `@vesora/core/balance` entry. The display uses the same canonical category quantities in an exact 2D comparison and equal-footprint 3D vessels, accompanied by values and percentages. There is no claim of a new physical law or a world-first chart.

## Physical meaning

There are three to eight categories with finite, nonnegative quantities. Every vessel has the same cross-sectional area, the same base elevation, the same constant-density incompressible fluid, and the same surface pressure. One connection is open at a time. The connection uses a constant laminar hydraulic conductance; inertia, sloshing, turbulence, capillarity and pipe storage are outside this model.

The UI must disclose the quantity-to-volume mapping. Defaults are one plotted unit = one litre (`volumeScale = 0.001 m³/unit`), area `1 m²`, density `1000 kg/m³`, gravity `9.81 m/s²`, and conductance `0.00005 m³/(Pa·s)`. These are simulation inputs, not an inference that the user's original data is water. A non-volume business metric can use the mapping as an explicitly labelled analogy.

For plotted quantity q, physical volume V = s q, height h = V/A, and gauge pressure p = ρgh. Equal vessel area makes model height proportional to quantity; the 3D world geometry preserves volume, while the 2D Membrane uses area to encode a connected pair’s volume proportions. Hydrostatic pressure follows the constant-density relationship described in [OpenStax 14.1](https://openstax.org/books/university-physics-volume-1/pages/14-1-fluids-density-and-pressure). Pascal's principle concerns transmission of applied pressure changes; it alone does not specify a flow rate.

For the selected connection, physical flow Q = C u (pₐ − pᵦ), where C is conductance and u is valve openness in [0,1]. This is the constant-resistance laminar approximation, consistent with Q = Δp/R and C = 1/R in [OpenStax 14.7](https://openstax.org/books/university-physics-volume-1/pages/14-7-viscosity-and-turbulence). No numerical claim about real turbulent pipe flow is made.

Conductance is an illustrative effective model parameter. Pipe radius, length and viscosity are not specified, so the model does not calculate Reynolds number or verify that a physical pipe would operate in the assumed laminar regime. The default animation is therefore not a calibrated water-apparatus prediction.

With equal areas, the derived two-vessel solution is:

```
D = qₐ − qᵦ
λ = C ρ g u / A
D(t) = D(0) exp(−2 λ t)
transfer = D(0) [1 − exp(−2 λ t)] / 2
```

`stepBalance` uses `expm1` for small steps. A transfer cannot exceed half the initial difference, so the vessels cannot cross equilibrium. Changing the named from/to order changes the signed transfer, not the resulting physical state. This is an analytic solution for one valve, not an order-independent solution for multiple simultaneously open valves.

Each transfer preserves the pair total; unconnected categories remain unchanged. Conservation of volume for constant-density incompressible flow follows the continuity reasoning in [OpenStax 14.5](https://openstax.org/books/university-physics-volume-1/pages/14-5-fluid-dynamics). Numerical equality is subject to ordinary Float64 rounding. Tests include repeated valve changes and widely separated quantity scales; exact no-ops preserve even tiny quantities.

Gravitational potential energy relative to the common base is E = Σ ρ g Vᵢ²/(2A). Passive equilibration decreases E; `dissipatedEnergy` reports that decrease, clipped only against negative floating-point residue. A manual redistribution can raise E. Its signed `externalWork` is the potential-energy change in this ideal model, not an estimate of a real pump's electrical consumption.

## API and display contract

```ts
import {createBalance, inspectBalance, stepBalance, transferBalance} from '@vesora/core/balance';

const initial = createBalance([
  {id:'a', label:'A', volume:80},
  {id:'b', label:'B', volume:20},
  {id:'c', label:'C', volume:0},
]);
const passive = stepBalance(initial, {from:'a', to:'b', openness:0.5}, 0.1);
const rows = inspectBalance(passive.state);
const manual = transferBalance(passive.state, 'b', 'a', 5);
```

States are immutable, detached values. `state.total` is the conserved plotted total; `state.elapsed` is simulated time; `state.energy` is joules. Readings expose quantity, share (0–1), height (metres), and gauge pressure (pascals). All-zero inputs have zero shares. A transition reports signed transferred quantity and the **average** quantity/time over that passive step, not an instantaneous flow rate.

`transferBalance` is a separate, explicitly labelled manual operation. It may move quantity uphill and is capped by available quantity. It must not be animated or described as a spontaneous pressure-driven transfer. It does not advance simulated time.

The common 3D vessel capacity may be the initial total: that bound accommodates any permitted redistribution. Perspective must not replace exact reading; retain the Membrane’s explicit pair scope and numeric table. Surface motion, particles and decorative waves, if added later, must not alter canonical fill levels or be presented as measured data.

Simulation settings belong in an explicit model snapshot or application export. When plotting model output through Figure, use only the existing declared source semantics; do not add arbitrary simulation keys or pretend the model is an externally executed transform. HTML observation capture describes the exported plot's actual source values. It does not by itself capture or resume the simulation controller.

## Implemented UI encoding

The public mathematical model is [balance.ts](../../packages/core/src/balance.ts), available through `@vesora/core/balance`. The reusable `BalanceChart` and its interactive controller `BalanceDemo` live in the [React example](../../examples/react-saas/src/BalanceDemo.tsx); they are example components, not new `@vesora/react` package exports.

The 2D Membrane represents only the selected pair in a fixed rectangular area; its heading gives both the pair total and the overall total. All categories remain available as accessible numeric selection buttons. For pair quantities a and b, the left area fraction is r = a/(a+b), and the right fraction is 1-r. The target boundary is the rectangle’s midpoint. For any supported quantity mapping, displayed litres are q * volumeScale * 1000.

With rectangle width W and height H, the shared cubic boundary has control points:

```
c = W r
k = 3 W r (1-r) (2r-1)
P0=(c,0), P1=(c+k,H/3), P2=(c-k,2H/3), P3=(c,H)
```

Its vertical coordinate is Ht and its horizontal deflection is 3k*t*(1-t)*(1-2t), which integrates to zero. The left and right areas therefore equal W*H*r and W*H*(1-r). The curve remains inside the rectangle and on the same side of the midpoint as r: with g=3t(1-t)(1-2t), x/W - 1/2 = (r-1/2)[1+6r(1-r)g], whose bracket is positive. The hatched area between the current boundary and midpoint is exactly |a-b|/(2(a+b)) of the pair’s area, representing the quantity |a-b|/2 needed to reach equal shares. At r=1/2 the curve is straight and the hatched area vanishes.

This curve is a visual encoding, not a simulated membrane or free fluid surface. The pair rectangle has no rounded area clipping. Empty pairs have no filled quantitative regions. Baseline curves appear only when the saved and current pair totals match; per-category numeric deltas remain available otherwise. The table reports volume, overall share, baseline change, physical height and pressure.

The 3D view uses the shared renderer's surface and 3D-line layers. Each square footprint has side `sqrt(area)` in metres; fluid boundaries and top surfaces use the model height `q * volumeScale / area`. Every category therefore encodes the same physical volume in world coordinates. The display independently normalizes its axes and exaggerates height to make shallow vessels legible. This is stated in the visible view description, exported figure title, height axis and height source semantics. Screen-space apparent volume is not a physical measurement; the 2D comparison and values remain the reading reference.

The transfer direction follows the actual higher-pressure category. Closed valves and zero conductance do not imply passive motion. The demo’s instantaneous-flow readout evaluates C * openness * Δp; it is distinct from the model transition’s mean flow over a finite step. Manual redistribution and its signed external-work change are separately labelled.

HTML export captures the displayed **3D scene snapshot**, including embedded numeric sources, metre/litre semantics and its observation record. It does not include the 2D SVG, running simulation controller, manual-work history or a resumable set of model controls. Export text says this explicitly; no external-transform declaration is used to imply that simulation execution was captured.

The Denge signature combines a conserved pair area, a curved split, the explicit transfer-to-equilibrium area, and a linked physical model with exportable observations. This is Vesora’s experimental interaction and presentation design built on established visualization techniques and physics; no exhaustive prior-art or world-first claim is made.

## Verification

`tests/unit/balance.test.ts` checks the analytic solution; time subdivision and direction symmetry; no overshoot at very large time; zero input/closed valve/no-op behavior; conservative bounded manual transfers; passive energy monotonicity over 3,000 valve changes; input ownership; invalid IDs, quantities, parameters, openness and numeric overflow. This validates the simplified model's implementation, not a CFD solver or experimental apparatus.

The focused browser suite samples the actual closed SVG paths and independently checks their polygon areas against the model’s pair proportions and required transfer, in both directions. It also checks keyboard selection, 320/390 px layouts, nonnegative conserved volumes and exact 3D observation buffers.
