// FILE MỚI → paste vào: src/services/personaService.js
//
// Lưu trữ dùng chung client.db (giống hệt pattern trong bieuCamService.js):
//   persona:{guildId}:{key}        -> { key, name, avatarUrl, rooms:[channelId,...], freeRoam }
//   personaAction:{guildId}:{key}  -> "<personaKey>"  (hành động nào đang dùng tính cách nào)

import { PERSONA_ACTIONS } from '../config/personaActions.js';

function personaDbKey(guildId, key) {
    return `persona:${guildId}:${key.toLowerCase()}`;
}
function personaListPrefix(guildId) {
    return `persona:${guildId}:`;
}
function actionDbKey(guildId, actionKey) {
    return `personaAction:${guildId}:${actionKey}`;
}
function actionListPrefix(guildId) {
    return `personaAction:${guildId}:`;
}

// Giống hệt cách bieuCamService.js đọc client.db.list — phòng trường hợp
// list() trả về mảng key hoặc object tuỳ tầng lưu trữ bên dưới.
async function listDbKeys(client, prefix) {
    if (!client.db?.list) return [];
    let keys = await client.db.list(prefix).catch(() => []);
    if (!Array.isArray(keys)) {
        keys = typeof keys === 'object' && keys !== null ? Object.keys(keys) : [];
    }
    return keys.filter((k) => k.startsWith(prefix));
}

export function slugifyPersonaKey(name) {
    return name
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // bỏ dấu tiếng Việt
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

export async function createPersona(client, guildId, { name, avatarUrl, createdBy }) {
    const key = slugifyPersonaKey(name);
    if (!key) throw new Error('Tên tính cách không hợp lệ.');

    const existing = await client.db.get(personaDbKey(guildId, key)).catch(() => null);
    if (existing) throw new Error(`Tính cách "${name}" đã tồn tại.`);

    const record = {
        key,
        name,
        avatarUrl,
        rooms: [],
        freeRoam: false,
        createdBy,
        createdAt: Date.now(),
    };
    await client.db.set(personaDbKey(guildId, key), record);
    return record;
}

export async function deletePersona(client, guildId, key) {
    const existing = await client.db.get(personaDbKey(guildId, key)).catch(() => null);
    if (!existing) return false;
    await client.db.delete(personaDbKey(guildId, key));

    // Gỡ mọi hành động đang gán cho persona vừa xoá, tránh treo mapping chết.
    const actionKeys = await listDbKeys(client, actionListPrefix(guildId));
    for (const dbKey of actionKeys) {
        const assignedPersonaKey = await client.db.get(dbKey).catch(() => null);
        if (assignedPersonaKey === key) {
            await client.db.delete(dbKey);
        }
    }
    return true;
}

export async function listPersonas(client, guildId) {
    const keys = await listDbKeys(client, personaListPrefix(guildId));
    const personas = [];
    for (const dbKey of keys) {
        const data = await client.db.get(dbKey).catch(() => null);
        if (data) personas.push(data);
    }
    return personas.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getPersona(client, guildId, key) {
    return await client.db.get(personaDbKey(guildId, key)).catch(() => null);
}

export async function addRoom(client, guildId, key, channelId) {
    const persona = await getPersona(client, guildId, key);
    if (!persona) throw new Error('Không tìm thấy tính cách.');
    if (!persona.rooms.includes(channelId)) {
        persona.rooms.push(channelId);
        await client.db.set(personaDbKey(guildId, key), persona);
    }
    return persona;
}

export async function removeRoom(client, guildId, key, channelId) {
    const persona = await getPersona(client, guildId, key);
    if (!persona) throw new Error('Không tìm thấy tính cách.');
    persona.rooms = persona.rooms.filter((id) => id !== channelId);
    await client.db.set(personaDbKey(guildId, key), persona);
    return persona;
}

// Đồng bộ toàn bộ danh sách phòng 1 lần (dùng khi lưu từ ChannelSelectMenu,
// vì menu trả về nguyên danh sách đang tick, không phải add/remove từng cái).
export async function setRooms(client, guildId, key, channelIds) {
    const persona = await getPersona(client, guildId, key);
    if (!persona) throw new Error('Không tìm thấy tính cách.');
    persona.rooms = [...new Set(channelIds)];
    await client.db.set(personaDbKey(guildId, key), persona);
    return persona;
}

export async function setFreeRoam(client, guildId, key, freeRoam) {
    const persona = await getPersona(client, guildId, key);
    if (!persona) throw new Error('Không tìm thấy tính cách.');
    persona.freeRoam = freeRoam;
    await client.db.set(personaDbKey(guildId, key), persona);
    return persona;
}

export async function assignAction(client, guildId, actionKey, personaKeyValue) {
    if (!PERSONA_ACTIONS[actionKey]) throw new Error('Hành động không tồn tại.');
    await client.db.set(actionDbKey(guildId, actionKey), personaKeyValue);
}

export async function unassignAction(client, guildId, actionKey) {
    await client.db.delete(actionDbKey(guildId, actionKey));
}

export async function getAssignedPersonaKey(client, guildId, actionKey) {
    return await client.db.get(actionDbKey(guildId, actionKey)).catch(() => null);
}

export async function listActionAssignments(client, guildId) {
    const result = {};
    for (const actionKey of Object.keys(PERSONA_ACTIONS)) {
        result[actionKey] = await getAssignedPersonaKey(client, guildId, actionKey);
    }
    return result;
}
