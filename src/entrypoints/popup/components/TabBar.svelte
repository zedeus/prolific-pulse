<script lang="ts">
  let { activeTab, onTabChange } = $props<{
    activeTab: string;
    onTabChange: (tab: string) => void;
  }>();

  const tabs = ['live', 'feed', 'submissions', 'settings'] as const;

  function tabLabel(tab: string): string {
    return tab.charAt(0).toUpperCase() + tab.slice(1);
  }
</script>

<div class="flex border-b border-base-300" role="tablist" aria-label="Popup tabs">
  {#each tabs as tab (tab)}
    <button
      class="flex-1 border-b-2 bg-transparent text-base-content/50 text-sm font-semibold leading-none py-2.5 cursor-pointer text-center transition-colors duration-100 hover:text-base-content/70 {activeTab === tab ? 'tab-active !text-primary !border-primary' : 'border-transparent'}"
      type="button"
      data-tab={tab}
      role="tab"
      aria-selected={activeTab === tab ? 'true' : 'false'}
      onclick={() => onTabChange(tab)}
    >
      {tabLabel(tab)}
    </button>
  {/each}
</div>
