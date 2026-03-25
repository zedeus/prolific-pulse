<script lang="ts">
  let { offline, errorMessage, latestRefreshText, latestRefreshTitle, refreshPrefix } = $props<{
    offline: boolean;
    errorMessage: string;
    latestRefreshText: string;
    latestRefreshTitle: string;
    refreshPrefix: string;
  }>();
</script>

<div class="flex flex-col gap-0 mb-3">
  <div class="flex items-center gap-2 px-0.5 pb-2.5">
    <div class="flex items-center gap-2 min-w-0 text-base-content/60 whitespace-nowrap text-[13px] font-medium">
      <span
        id="syncDot"
        class="inline-block w-[9px] h-[9px] rounded-full flex-none {offline ? 'bg-error shadow-[0_0_0_2px_rgba(225,29,72,0.15)] bad' : 'bg-success shadow-[0_0_0_2px_rgba(26,147,111,0.15)]'}"
        title="Sync status"
      ></span>
      <span class="whitespace-nowrap font-semibold text-base-content/70">
        <span>{refreshPrefix}</span><span id="latestRefresh" title={latestRefreshTitle}>{latestRefreshText}</span>
      </span>
    </div>
  </div>
</div>

{#if errorMessage}
  <div
    id="errorMessage"
    class="alert alert-error mb-2.5 text-[13px] leading-snug py-2.5 px-3.5"
  >
    {errorMessage}
  </div>
{:else}
  <div id="errorMessage" class="hidden"></div>
{/if}
