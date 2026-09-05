// FILE MỚI → paste vào: src/config/personaActions.js
//
// Danh sách "hành động" có thể gán tính cách (persona) đứng tên khi gửi.
// Menu "🔗 Gán lệnh" trong /tleeoi tự đọc object này mỗi lần mở.
//
// Khi có tính năng mới cần đứng tên riêng: chỉ cần thêm ĐÚNG 1 DÒNG ở đây
// (key = định danh nội bộ dùng trong code, value = tên hiển thị trong menu).
// KHÔNG cần sửa gì trong personaService.js, personaWebhook.js, tleeoi.js
// hay tleelist.js — toàn bộ hệ thống persona/quyền phòng tự động nhận diện
// hành động mới này.
export const PERSONA_ACTIONS = {
    tlee_tag: 'Gửi biểu cảm (/tlee)',
};
