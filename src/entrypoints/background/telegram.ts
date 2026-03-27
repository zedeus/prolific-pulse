import { browser } from 'wxt/browser';
import type { Study, TelegramSettings, TelegramMessageFormatOptions, PriorityFilter } from '../../lib/types';
import { TELEGRAM_SETTINGS_KEY, TELEGRAM_API_BASE_URL } from '../../lib/constants';
import { formatMoneyFromMinorUnits, formatDurationMinutes, compactText, studyUrlFromId, toUserErrorMessage, escapeHTML, stripHTML, formatStudyLabel } from '../../lib/format';

const BOT_TOKEN_REGEX = /^\d{5,16}:[A-Za-z0-9_-]{35}$/;

export function isValidBotTokenFormat(token: string): boolean {
  return BOT_TOKEN_REGEX.test(token.trim());
}

export function normalizeTelegramSettings(raw: unknown): TelegramSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fmt = (r.message_format && typeof r.message_format === 'object' ? r.message_format : {}) as Record<string, unknown>;

  return {
    enabled: r.enabled === true,
    bot_token: typeof r.bot_token === 'string' ? r.bot_token.trim() : '',
    chat_id: typeof r.chat_id === 'string' ? r.chat_id.trim() : '',
    notify_all_studies: r.notify_all_studies === true,
    silent_notifications: r.silent_notifications === true,
    message_format: {
      include_reward: fmt.include_reward !== false,
      include_hourly_rate: fmt.include_hourly_rate !== false,
      include_duration: fmt.include_duration !== false,
      include_places: fmt.include_places !== false,
      include_researcher: fmt.include_researcher !== false,
      include_tags: fmt.include_tags !== false,
      include_description: fmt.include_description === true,
      include_link: fmt.include_link !== false,
    },
  };
}

export function isTelegramConfigured(settings: TelegramSettings): boolean {
  return settings.enabled && settings.bot_token.length > 0 && settings.chat_id.length > 0;
}

export async function loadTelegramSettings(): Promise<TelegramSettings> {
  const data = await browser.storage.local.get(TELEGRAM_SETTINGS_KEY);
  return normalizeTelegramSettings(data[TELEGRAM_SETTINGS_KEY]);
}

export async function saveTelegramSettings(settings: TelegramSettings): Promise<TelegramSettings> {
  const normalized = normalizeTelegramSettings(settings);
  await browser.storage.local.set({ [TELEGRAM_SETTINGS_KEY]: normalized });
  return normalized;
}

function classifyTelegramError(status: number, description: string): string {
  if (status === 401) return 'Invalid bot token';
  if (status === 403) {
    if (description.includes('blocked')) return 'Bot was blocked by user';
    if (description.includes('initiate')) return 'Send /start to the bot first';
    return 'Bot cannot message this chat';
  }
  if (status === 400) {
    if (description.includes('chat not found')) return 'Chat ID not found';
    if (description.includes('PEER_ID_INVALID')) return 'Invalid chat ID — send /start to bot first';
    if (description.includes('too long')) return 'Message too long';
    if (description.includes('empty')) return 'Message is empty';
  }
  if (status === 429) {
    const match = description.match(/retry after (\d+)/i);
    return match ? `Rate limited — retry in ${match[1]}s` : 'Rate limited';
  }
  return description || `HTTP ${status}`;
}

function formatDetail(value: string): string | null {
  const v = value.trim();
  return v && v !== 'n/a' ? v : null;
}

export function formatTelegramMessage(
  study: Study,
  filter: PriorityFilter | null,
  format: TelegramMessageFormatOptions,
): string {
  const lines: string[] = [];
  const title = escapeHTML(study.name || 'Untitled Study');
  lines.push(filter ? `<b>❗️${title}</b>` : `<b>${title}</b>`);

  const details: string[] = [];
  if (format.include_reward) {
    const v = formatDetail(formatMoneyFromMinorUnits(study.reward));
    if (v) details.push(escapeHTML(v));
  }
  if (format.include_hourly_rate) {
    const v = formatDetail(formatMoneyFromMinorUnits(study.average_reward_per_hour));
    if (v) details.push(`${escapeHTML(v)}/hr`);
  }
  if (format.include_duration) {
    const v = formatDetail(formatDurationMinutes(study.estimated_completion_time));
    if (v) details.push(escapeHTML(v));
  }
  if (format.include_places) {
    const places = Number(study.places_available);
    if (Number.isFinite(places)) details.push(`${places} place${places !== 1 ? 's' : ''}`);
  }
  if (format.include_researcher && study.researcher?.name) details.push(escapeHTML(study.researcher.name));
  if (details.length) lines.push(details.join(' · '));

  if (format.include_tags) {
    const tags: string[] = [];
    const typeLabel = formatStudyLabel(study.study_labels, study.ai_inferred_study_labels);
    if (typeLabel) tags.push(escapeHTML(typeLabel));
    if (study.max_submissions_per_participant > 1) tags.push('Multi-submit');
    if (study.is_custom_screening) tags.push('Screening');
    if (tags.length) lines.push(tags.join(' · '));
  }

  if (format.include_description && study.description) {
    const plain = stripHTML(study.description);
    if (plain) lines.push(`<i>${escapeHTML(compactText(plain, 200))}</i>`);
  }

  if (filter) {
    lines.push(`<i>Filter: ${escapeHTML(filter.name)}</i>`);
  }

  return lines.join('\n');
}

type InlineKeyboard = { text: string; url: string }[][];
type ReplyMarkup = { inline_keyboard: InlineKeyboard };

export function buildStudyReplyMarkup(
  study: Study,
  format: TelegramMessageFormatOptions,
): ReplyMarkup | undefined {
  if (!format.include_link || !study.id) return undefined;
  return { inline_keyboard: [[{ text: '📋 Open study', url: studyUrlFromId(study.id) }]] };
}

export interface SendTelegramResult {
  ok: boolean;
  error?: string;
  description?: string;
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  silent: boolean = false,
  replyMarkup?: ReplyMarkup,
): Promise<SendTelegramResult> {
  if (!botToken || !chatId || !text) {
    return { ok: false, error: 'Missing bot token, chat ID, or message text' };
  }

  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      disable_notification: silent,
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    const response = await fetch(`${TELEGRAM_API_BASE_URL}${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (result.ok) {
      return { ok: true };
    }

    const description = String(result.description || '');
    return {
      ok: false,
      error: classifyTelegramError(response.status, description),
      description,
    };
  } catch (error) {
    return {
      ok: false,
      error: toUserErrorMessage(error),
    };
  }
}

export interface VerifyBotResult {
  ok: boolean;
  bot_name?: string;
  bot_username?: string;
  error?: string;
}

export async function verifyTelegramBot(botToken: string): Promise<VerifyBotResult> {
  if (!botToken) {
    return { ok: false, error: 'Bot token is required' };
  }
  if (!isValidBotTokenFormat(botToken)) {
    return { ok: false, error: 'Invalid token format' };
  }

  try {
    const response = await fetch(`${TELEGRAM_API_BASE_URL}${botToken}/getMe`, {
      method: 'GET',
    });
    const result = await response.json();

    if (result.ok && result.result) {
      return {
        ok: true,
        bot_name: result.result.first_name || '',
        bot_username: result.result.username || '',
      };
    }

    return { ok: false, error: classifyTelegramError(response.status, String(result.description || '')) };
  } catch (error) {
    return { ok: false, error: toUserErrorMessage(error) };
  }
}

export async function sendTelegramTestMessage(
  botToken: string,
  chatId: string,
  format: TelegramMessageFormatOptions,
): Promise<SendTelegramResult> {
  const sampleStudy: Study = {
    id: 'sample000000000000000000',
    name: 'Sample Study — Test Notification',
    study_type: 'SINGLE',
    is_custom_screening: false,
    date_created: new Date().toISOString(),
    published_at: new Date().toISOString(),
    total_available_places: 50,
    places_taken: 12,
    places_available: 38,
    reward: { amount: 450, currency: 'GBP' },
    average_reward_per_hour: { amount: 900, currency: 'GBP' },
    max_submissions_per_participant: 1,
    researcher: { id: 'r1', name: 'Dr. Example', country: 'GB' },
    description: 'This is a test notification from Prolific Pulse to preview your message format.',
    estimated_completion_time: 15,
    device_compatibility: ['desktop'],
    peripheral_requirements: [],
    maximum_allowed_time: 1800,
    average_completion_time_in_seconds: 720,
    is_confidential: false,
    is_ongoing_study: false,
    pii_enabled: false,
    study_labels: [],
    ai_inferred_study_labels: [],
    previous_submission_count: 0,
  };

  return sendTelegramMessage(
    botToken, chatId,
    formatTelegramMessage(sampleStudy, null, format),
    false,
    buildStudyReplyMarkup(sampleStudy, format),
  );
}
