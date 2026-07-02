<script lang="ts">
  import type { ReliabilityScore } from '../../../lib/researcher-profile';
  import { reliabilityBandColorClass, reliabilityBandLabel } from '../../../lib/researcher-profile';

  // Two forms of the at-a-glance reliability marker:
  //  - default: the numeric score, tinted by band (used in the profile card / directory / picker).
  //  - star:    a single gold star shown ONLY for top-rated ("Excellent") researchers — a low-noise
  //             signal for dense study rows, where a number next to every name is too much.
  // Both render nothing until a researcher has enough rated history.
  let { reliability, class: klass = '', star = false }: {
    reliability: ReliabilityScore | null | undefined;
    class?: string;
    star?: boolean;
  } = $props();
</script>

{#if star}
  {#if reliability?.hasEnoughData && reliability.band === 'excellent'}
    <span
      class="reliability-star inline-flex items-center leading-none text-[11px] text-amber-500 {klass}"
      title="Top-rated researcher · {reliability.score}/100"
      role="img"
      aria-label="Top-rated researcher, reliability {reliability.score} out of 100"
    >&#9733;</span>
  {/if}
{:else if reliability?.hasEnoughData}
  <span
    class="reliability-badge inline-flex items-center leading-none align-baseline text-[9px] font-bold tabular-nums px-1 py-[1px] rounded-full bg-current/10 {reliabilityBandColorClass(reliability.band)} {klass}"
    title="Reliability {reliability.score}/100 — {reliabilityBandLabel(reliability.band)}"
  >{reliability.score}</span>
{/if}
