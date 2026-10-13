// grammY's Node shim loads node-fetch v2 (deprecated punycode/url.parse warnings). The bot uses
// Node's built-in fetch instead (TelegramService), so the bundle gets this stand-in.
module.exports = { default: globalThis.fetch }
