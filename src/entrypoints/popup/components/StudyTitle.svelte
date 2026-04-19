<script lang="ts">
  let { name, researcherName = '' }: { name: string; researcherName?: string } = $props();
</script>

{name}{#if researcherName}&#32;<span class="font-normal text-base-content/45">· {researcherName}</span>{/if}
