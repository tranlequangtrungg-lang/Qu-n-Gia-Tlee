// FILE MỚI → paste vào: src/commands/Fun/tleelist.js
//
// Mở thẳng vào bảng "Quản lý phòng" (xem + tick/bỏ tick ngay trong bảng),
// dùng chung logic với /tleeoi để không viết lại code.

import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { startPersonaPanel } from './tleeoi.js';

export default {
    data: new SlashCommandBuilder()
        .setName('tleelist')
        .setDescription('[Admin] Xem và chỉnh phòng cho từng tính cách Tlee')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'fun',
    async execute(interaction, config, client) {
        await startPersonaPanel(interaction, client, { initialView: 'rooms' });
    },
};
