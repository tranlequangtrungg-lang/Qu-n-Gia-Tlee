import { buildOverviewView, buildCategoryView, GROUP_ORDER } from '../../../handlers/tleecuube/tleecuubeView.js';
import { logger } from '../../../utils/logger.js';

async function safeUpdate(interaction, view) {
    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate();
        }
        await interaction.editReply(view);
    } catch (error) {
        if (error?.code === 40060 || error?.code === 10062) {
            logger.warn('Tleecuube button interaction already acknowledged or expired.', {
                event: 'interaction.tleecuube.button.unavailable',
                customId: interaction.customId,
            });
            return;
        }
        throw error;
    }
}

const backButton = {
    name: 'tleecuube-back',
    async execute(interaction, client) {
        const view = await buildOverviewView(client);
        await safeUpdate(interaction, view);
    },
};

const categoryButtons = GROUP_ORDER.map((key) => ({
    name: `tleecuube-view_${key}`,
    async execute(interaction, client) {
        const view = await buildCategoryView(client, key);
        await safeUpdate(interaction, view);
    },
}));

export default [backButton, ...categoryButtons];
