// src/utils/commandRooms.js
//
// Central place to configure which Discord channel a command (or a specific
// subcommand) is allowed to be used in. Edit the two maps below to change
// which channel is required — no need to touch interactionCreate.js or any
// individual command file.
//
// - CATEGORY_ROOMS: applies to every command sharing that `category` value
//   (the same `category` field already set on each command's export, e.g.
//   category: "economy").
// - SUBCOMMAND_ROOMS: overrides CATEGORY_ROOMS for a specific
//   "commandName:subcommand" pair. Use this when different subcommands of
//   the same slash command (e.g. /casino taixiu vs /casino xocdia) need
//   different channels.
//
// A command/subcommand with no entry in either map is not restricted.

export const CATEGORY_ROOMS = {
  // Toàn bộ lệnh kiếm Bcoin (category: "economy") — ví dụ /daily, /work, /rob...
  economy: '1535436207289405441',

  // Toàn bộ lệnh nhạc (category: "music") — ví dụ /play, /skip, /queue...
  music: '1312450758725075064',
};

export const SUBCOMMAND_ROOMS = {
  // /casino taixiu (Tài Xỉu Đơn)
  'casino:taixiu': '1536115257599336679',
  // /casino tx (Tài Xỉu Nhóm)
  'casino:tx': '1537615010220605540',
  // /casino xocdia (Xóc Đĩa)
  'casino:xocdia': '1536115313987551272',

  // Blackjack chưa code — khi xong, thêm dòng dạng:
  // 'casino:blackjack': '1534966196548665384',
};

/**
 * Figures out which channel ID (if any) a given interaction is required to
 * be used in. Subcommand-level rules always win over category-level rules.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {{ category?: string }} command
 * @returns {string|null} required channel ID, or null if unrestricted
 */
export function resolveRequiredChannelId(interaction, command) {
  let subcommand = null;
  try {
    subcommand = interaction.options.getSubcommand(false);
  } catch {
    subcommand = null;
  }

  if (subcommand) {
    const subKey = `${interaction.commandName}:${subcommand}`;
    if (SUBCOMMAND_ROOMS[subKey]) {
      return SUBCOMMAND_ROOMS[subKey];
    }
  }

  if (command?.category && CATEGORY_ROOMS[command.category]) {
    return CATEGORY_ROOMS[command.category];
  }

  return null;
}
