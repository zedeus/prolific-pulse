<script lang="ts">
  interface Props {
    name: string;
    researcherName?: string;
    /** When set (with onResearcherClick), the researcher name becomes a button opening their profile. */
    researcherId?: string;
    onResearcherClick?: (id: string, name: string) => void;
  }

  let { name, researcherName = '', researcherId = '', onResearcherClick }: Props = $props();

  const clickable = $derived(Boolean(researcherId && onResearcherClick));

  function handleClick(e: MouseEvent) {
    if (!researcherId || !onResearcherClick) return;
    // Study rows are wrapped in a link/row handler — don't let the click bubble to it.
    e.preventDefault();
    e.stopPropagation();
    onResearcherClick(researcherId, researcherName);
  }
</script>

{name}{#if researcherName}<span class="font-normal text-base-content/45"> · {#if clickable}<button
      type="button"
      class="researcher-link inline text-inherit hover:text-primary hover:underline underline-offset-2 cursor-pointer bg-transparent border-0 p-0 font-inherit text-left align-baseline"
      title="View {researcherName}'s reliability profile"
      onclick={handleClick}
    >{researcherName}</button>{:else}{researcherName}{/if}</span>{/if}
