import { createEmbed } from '../../utils/embeds.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const GROUP_ORDER = ['economy', 'fun', 'music', 'roles'];

export const GROUPS = {
    economy: { label: '💰 Kiếm Bcoin', color: 'economy' },
    fun: { label: '🎮 Giải Trí', color: 'fuchsia' },
    music: { label: '🎵 Nghe Nhạc', color: 'blurple' },
    roles: { label: '🎭 Vai Trò', color: 'green' },
};

function resolveGroupKey(command) {
    const category = command.category;

    if (category === 'Economy' && command.data.name === 'casino') {
        return 'fun';
    }
    if (category === 'Economy') return 'economy';
    if (category === 'Fun') return 'fun';
    if (category === 'Music') return 'music';
    if (category === 'Reaction_roles') return 'roles';

    return null;
}

export function buildGroupedCommands(client) {
    const groups = { economy: [], fun: [], music: [], roles: [] };

    for (const command of client.commands.values()) {
        const key = resolveGroupKey(command);
        if (key) {
            groups[key].push(command);
        }
    }

    for (const key of GROUP_ORDER) {
        groups[key].sort((a, b) => a.data.name.localeCompare(b.data.name));
    }

    return groups;
}

async function fetchAppCommands(client) {
    try {
        return await client.application.commands.fetch();
    } catch (error) {
        return new Map();
    }
}

function mentionOrFallback(name, appCommands) {
    const found = [...appCommands.values()].find((c) => c.name === name);
    return found ? `</${name}:${found.id}>` : `\`/${name}\``;
}

export function buildOverviewButtons(groups) {
    const buttons = GROUP_ORDER
        .filter((key) => groups[key].length > 0)
        .map((key) =>
            new ButtonBuilder()
                .setCustomId(`tleecuube-view_${key}`)
                .setLabel(GROUPS[key].label)
                .setStyle(ButtonStyle.Secondary),
        );

    return buttons.length > 0 ? [new ActionRowBuilder().addComponents(buttons)] : [];
}

export async function buildOverviewView(client) {
    const groups = buildGroupedCommands(client);

    const embed = createEmbed({
        title: '📖 Danh Sách Lệnh',
        description: 'Chọn 1 mục bên dưới để xem danh sách lệnh chi tiết.',
        color: 'primary',
        fields: GROUP_ORDER
            .filter((key) => groups[key].length > 0)
            .map((key) => ({
                name: GROUPS[key].label,
                value: `${groups[key].length} lệnh`,
                inline: true,
            })),
    });

    return {
        embeds: [embed],
        components: buildOverviewButtons(groups),
    };
}

export async function buildCategoryView(client, key) {
    const groups = buildGroupedCommands(client);
    const commands = groups[key] || [];
    const appCommands = await fetchAppCommands(client);
    const group = GROUPS[key];

    const description = commands.length > 0
        ? commands
            .map((cmd) => `${mentionOrFallback(cmd.data.name, appCommands)} — ${cmd.data.description || ''}`)
            .join('\n')
        : 'Chưa có lệnh nào trong mục này.';

    const embed = createEmbed({
        title: group.label,
        description,
        color: group.color,
    });

    const backButton = new ButtonBuilder()
        .setCustomId('tleecuube-back')
        .setLabel('⬅️ Quay lại')
        .setStyle(ButtonStyle.Secondary);

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(backButton)],
    };
}
