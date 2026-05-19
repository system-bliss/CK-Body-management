import type { Env, StoredMessage } from "../types";

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id?: number;
  date?: number;
  chat?: { id?: number | string; type?: string };
  from?: { id?: number; is_bot?: boolean; first_name?: string; username?: string };
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
}

export interface TelegramPhotoSize {
  file_id?: string;
  file_unique_id?: string;
  width?: number;
  height?: number;
  file_size?: number;
}

export interface TelegramInboundMessage {
  updateId?: number | undefined;
  messageId: number;
  chatId: number | string;
  userId: number | string;
  date: number;
  content: string;
  photoFileId?: string | undefined;
}

export function normalizeTelegramUpdate(update: TelegramUpdate): TelegramInboundMessage | null {
  const message = update.message;
  if (!message?.message_id || !message.chat?.id) return null;

  const photo = largestPhoto(message.photo);
  const userId = message.from?.id ?? message.chat.id;
  return {
    updateId: update.update_id,
    messageId: message.message_id,
    chatId: message.chat.id,
    userId,
    date: message.date ?? Math.floor(Date.now() / 1000),
    content: (message.text ?? message.caption ?? "").trim(),
    photoFileId: photo?.file_id
  };
}

export function telegramMessageToStoredMessage(input: TelegramInboundMessage): StoredMessage {
  return {
    toUserName: "telegram",
    fromUserName: String(input.userId || input.chatId),
    createTime: input.date,
    msgType: input.photoFileId ? "image" : "text",
    content: input.content,
    msgId: String(input.messageId)
  };
}

export function telegramSendMessageRequest(
  botToken: string,
  chatId: number | string,
  content: string
): { url: string; init: RequestInit; body: { chat_id: number | string; text: string } } {
  const body = { chat_id: chatId, text: content };
  return {
    url: telegramApiUrl(botToken, "sendMessage"),
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    },
    body
  };
}

export function fetchTelegramFileRequest(botToken: string, fileId: string): { url: string; init: RequestInit } {
  const url = new URL(telegramApiUrl(botToken, "getFile"));
  url.searchParams.set("file_id", fileId);
  return { url: url.toString(), init: { method: "GET" } };
}

export async function sendTelegramText(env: Env, chatId: number | string, content: string): Promise<void> {
  const request = telegramSendMessageRequest(env.TELEGRAM_BOT_TOKEN, chatId, content);
  const response = await fetch(request.url, request.init);
  if (!response.ok) throw new Error(`Failed to send Telegram message: ${response.status} ${await response.text()}`);
  const body = (await response.json()) as { ok?: boolean; description?: string };
  if (!body.ok) throw new Error(`Failed to send Telegram message: ${body.description ?? "unknown error"}`);
}

export async function fetchTelegramPhoto(env: Env, fileId: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const request = fetchTelegramFileRequest(env.TELEGRAM_BOT_TOKEN, fileId);
  const response = await fetch(request.url, request.init);
  if (!response.ok) throw new Error(`Failed to get Telegram file: ${response.status}`);

  const body = (await response.json()) as { ok?: boolean; result?: { file_path?: string }; description?: string };
  const filePath = body.result?.file_path;
  if (!body.ok || !filePath) throw new Error(`Failed to get Telegram file: ${body.description ?? "missing file_path"}`);

  const fileResponse = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
  if (!fileResponse.ok) throw new Error(`Failed to download Telegram file: ${fileResponse.status}`);
  return {
    bytes: await fileResponse.arrayBuffer(),
    contentType: fileResponse.headers.get("content-type") ?? "application/octet-stream"
  };
}

function telegramApiUrl(botToken: string, method: string): string {
  return `https://api.telegram.org/bot${botToken}/${method}`;
}

function largestPhoto(photos: TelegramPhotoSize[] | undefined): TelegramPhotoSize | undefined {
  return [...(photos ?? [])]
    .filter((photo) => photo.file_id)
    .sort((a, b) => (b.file_size ?? (b.width ?? 0) * (b.height ?? 0)) - (a.file_size ?? (a.width ?? 0) * (a.height ?? 0)))[0];
}
