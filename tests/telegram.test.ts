import { describe, expect, it } from "vitest";
import {
  fetchTelegramFileRequest,
  normalizeTelegramUpdate,
  telegramMessageToStoredMessage,
  telegramSendMessageRequest
} from "../src/lib/telegram";

describe("Telegram bot webhook helpers", () => {
  it("normalizes text updates into a common inbound message", () => {
    const event = normalizeTelegramUpdate({
      update_id: 1000,
      message: {
        message_id: 42,
        date: 1700000000,
        chat: { id: 123456, type: "private" },
        from: { id: 123456, is_bot: false, first_name: "Deng" },
        text: "早餐：两个鸡蛋，一杯拿铁"
      }
    });

    expect(event).toEqual({
      updateId: 1000,
      messageId: 42,
      chatId: 123456,
      userId: 123456,
      date: 1700000000,
      content: "早餐：两个鸡蛋，一杯拿铁",
      photoFileId: undefined
    });
  });

  it("uses the largest photo and caption from photo updates", () => {
    const event = normalizeTelegramUpdate({
      update_id: 1001,
      message: {
        message_id: 43,
        date: 1700000001,
        chat: { id: -100123, type: "group" },
        photo: [
          { file_id: "small", file_unique_id: "u1", width: 90, height: 90, file_size: 2000 },
          { file_id: "large", file_unique_id: "u2", width: 1280, height: 720, file_size: 300000 }
        ],
        caption: "午餐"
      }
    });

    expect(event?.photoFileId).toBe("large");
    expect(event?.content).toBe("午餐");
  });

  it("builds Telegram API requests without leaking tokens into bodies", () => {
    const messageRequest = telegramSendMessageRequest("token", 123456, "已记录");
    const fileRequest = fetchTelegramFileRequest("token", "file-id");

    expect(messageRequest.url).toBe("https://api.telegram.org/bottoken/sendMessage");
    expect(messageRequest.body).toEqual({ chat_id: 123456, text: "已记录" });
    expect(fileRequest.url).toBe("https://api.telegram.org/bottoken/getFile?file_id=file-id");
  });

  it("converts Telegram messages into the storage message shape", () => {
    const stored = telegramMessageToStoredMessage({
      updateId: 1000,
      messageId: 42,
      chatId: 123456,
      userId: 123456,
      date: 1700000000,
      content: "体重 72kg"
    });

    expect(stored).toEqual({
      toUserName: "telegram",
      fromUserName: "123456",
      createTime: 1700000000,
      msgType: "text",
      content: "体重 72kg",
      msgId: "42"
    });
  });
});
