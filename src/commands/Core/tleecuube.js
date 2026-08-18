import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { buildOverviewView } from '../../handlers/tleecuube/tleecuubeView.js';

export default {
    data: new SlashCommandBuilder()
        .setName('tleecuube')
        .setDescription('Xem danh sách toàn bộ lệnh của bot'),

    async execute(interaction, guildConfig, client) {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const view = await buildOverviewView(client);
        await InteractionHelper.safeEditReply(interaction, view);
    },
};
