<script lang="ts">
  // A dependency-free inline-SVG sparkline (layerchart is too heavy for compact rows).
  // Draws `values` left→right; `stroke` uses currentColor so the caller sets the colour.
  interface Props {
    values: number[];
    width?: number;
    height?: number;
    class?: string;
    /** Draw a faint fill under the line. */
    fill?: boolean;
    title?: string;
  }

  let { values, width = 64, height = 18, class: klass = '', fill = false, title = '' }: Props = $props();

  const PAD = 1.5;

  const geometry = $derived.by(() => {
    const finite = values.filter((v) => Number.isFinite(v));
    if (finite.length < 2) return null;

    let min = Infinity;
    let max = -Infinity;
    for (const v of finite) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = max - min || 1;
    const innerW = width - PAD * 2;
    const innerH = height - PAD * 2;
    const stepX = innerW / (finite.length - 1);

    const points = finite.map((v, i) => {
      const x = PAD + i * stepX;
      const y = PAD + innerH - ((v - min) / span) * innerH;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });

    const line = points.join(' ');
    const area = `${PAD.toFixed(2)},${(height - PAD).toFixed(2)} ${line} ${(width - PAD).toFixed(2)},${(height - PAD).toFixed(2)}`;
    return { line, area };
  });
</script>

{#if geometry}
  <svg
    class={klass}
    width={width}
    height={height}
    viewBox="0 0 {width} {height}"
    preserveAspectRatio="none"
    role="img"
    aria-label={title || 'trend'}
  >
    {#if title}<title>{title}</title>{/if}
    {#if fill}
      <polygon points={geometry.area} fill="currentColor" opacity="0.12" stroke="none" />
    {/if}
    <polyline
      points={geometry.line}
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
{/if}
