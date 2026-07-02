// /api/ban/index.js
import fs from 'fs';
import path from 'path';

// ============================================================
// CONFIGURAÇÕES
// ============================================================
const BAN_FILE = path.join(process.cwd(), 'api/ban/banned-ips.json');
const LOG_FILE = path.join(process.cwd(), 'api/ban/ban-logs.json');

// ============================================================
// FUNÇÕES DE ARQUIVO
// ============================================================

// Ler lista de IPs banidos
function getBannedIPs() {
    try {
        if (!fs.existsSync(BAN_FILE)) {
            const defaultData = { 
                banned: [],
                stats: {
                    totalBans: 0,
                    permanentBans: 0,
                    temporaryBans: 0
                }
            };
            fs.writeFileSync(BAN_FILE, JSON.stringify(defaultData, null, 2));
            return defaultData;
        }
        const data = fs.readFileSync(BAN_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Erro ao ler arquivo de ban:', error);
        return { banned: [], stats: { totalBans: 0, permanentBans: 0, temporaryBans: 0 } };
    }
}

// Salvar lista de IPs banidos
function saveBannedIPs(data) {
    try {
        fs.writeFileSync(BAN_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Erro ao salvar arquivo de ban:', error);
        return false;
    }
}

// Ler logs de banimento
function getBanLogs() {
    try {
        if (!fs.existsSync(LOG_FILE)) {
            const defaultData = { logs: [] };
            fs.writeFileSync(LOG_FILE, JSON.stringify(defaultData, null, 2));
            return defaultData;
        }
        const data = fs.readFileSync(LOG_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Erro ao ler logs:', error);
        return { logs: [] };
    }
}

// Salvar log de banimento
function saveBanLog(log) {
    try {
        const data = getBanLogs();
        data.logs.push(log);
        // Manter apenas os últimos 1000 logs
        if (data.logs.length > 1000) {
            data.logs = data.logs.slice(-1000);
        }
        fs.writeFileSync(LOG_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Erro ao salvar log:', error);
        return false;
    }
}

// Verificar se IP está banido
function isIPBanned(ip, bannedList) {
    const now = Date.now();
    return bannedList.find(ban => {
        if (ban.ip === ip) {
            // Se tem data de expiração, verificar se ainda está válido
            if (ban.expires) {
                const expireDate = new Date(ban.expires).getTime();
                if (expireDate < now) {
                    return false; // Banimento expirado
                }
            }
            return true;
        }
        return false;
    });
}

// Limpar banimentos expirados automaticamente
function cleanupExpiredBans() {
    const data = getBannedIPs();
    const now = Date.now();
    let changed = false;

    data.banned = data.banned.filter(ban => {
        if (ban.expires) {
            const expireDate = new Date(ban.expires).getTime();
            if (expireDate < now) {
                changed = true;
                return false; // Remove banimento expirado
            }
        }
        return true;
    });

    if (changed) {
        // Atualizar estatísticas
        data.stats.totalBans = data.banned.length;
        data.stats.permanentBans = data.banned.filter(b => !b.expires).length;
        data.stats.temporaryBans = data.banned.filter(b => b.expires).length;
        saveBannedIPs(data);
    }
}

// ============================================================
// VALIDAÇÕES
// ============================================================

// Validar formato de IP
function isValidIP(ip) {
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipRegex.test(ip);
}

// Validar se é IPv6 ou localhost
function isSpecialIP(ip) {
    const specials = ['::1', '127.0.0.1', 'localhost', '0.0.0.0'];
    return specials.includes(ip);
}

// ============================================================
// API HANDLER
// ============================================================

export default async function handler(req, res) {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Limpar bans expirados automaticamente
    cleanupExpiredBans();

    const { method } = req;

    // ============================================================
    // GET - Listar/Verificar bans
    // ============================================================
    if (method === 'GET') {
        const data = getBannedIPs();

        // Verificar IP específico
        if (req.query.check) {
            const ip = req.query.check;
            const banned = isIPBanned(ip, data.banned);

            if (banned) {
                const isPermanent = !banned.expires;
                const timeLeft = banned.expires ? 
                    Math.max(0, Math.floor((new Date(banned.expires).getTime() - Date.now()) / (1000 * 60 * 60))) : 
                    null;

                return res.status(200).json({
                    banned: true,
                    reason: banned.reason,
                    expires: banned.expires,
                    date: banned.date,
                    permanent: isPermanent,
                    timeLeft: timeLeft ? `${timeLeft}h` : 'Permanente',
                    source: banned.source || 'manual'
                });
            }
            return res.status(200).json({ 
                banned: false,
                message: 'IP não está banido'
            });
        }

        // Listar todos os bans
        if (req.query.list === 'all') {
            return res.status(200).json({
                ...data,
                timestamp: new Date().toISOString()
            });
        }

        // Estatísticas de banimento
        if (req.query.stats === 'true') {
            const logs = getBanLogs();
            const now = Date.now();
            
            // Calcular bans nos últimos 7 dias
            const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
            const recentBans = logs.logs.filter(log => 
                new Date(log.timestamp).getTime() > sevenDaysAgo
            ).length;

            return res.status(200).json({
                stats: {
                    ...data.stats,
                    recentBans: recentBans,
                    totalLogs: logs.logs.length,
                    lastBan: logs.logs.length > 0 ? logs.logs[logs.logs.length - 1] : null
                },
                timestamp: new Date().toISOString()
            });
        }

        // Lista resumida
        return res.status(200).json({
            total: data.banned.length,
            banned: data.banned.map(ban => ({
                ip: ban.ip,
                reason: ban.reason,
                expires: ban.expires,
                permanent: !ban.expires,
                date: ban.date,
                source: ban.source || 'manual'
            }))
        });
    }

    // ============================================================
    // POST - Adicionar ban
    // ============================================================
    if (method === 'POST') {
        const { ip, reason, expires, source, adminKey } = req.body;

        // Validar IP
        if (!ip) {
            return res.status(400).json({ 
                error: true, 
                message: 'IP é obrigatório' 
            });
        }

        // Validar formato do IP
        if (!isValidIP(ip)) {
            return res.status(400).json({ 
                error: true, 
                message: 'Formato de IP inválido' 
            });
        }

        // Não permitir banir IPs especiais
        if (isSpecialIP(ip)) {
            return res.status(400).json({ 
                error: true, 
                message: 'Não é possível banir este IP' 
            });
        }

        const data = getBannedIPs();

        // Verificar se IP já está banido
        if (isIPBanned(ip, data.banned)) {
            return res.status(400).json({ 
                error: true, 
                message: 'IP já está banido' 
            });
        }

        // Verificar se o IP está na lista negra (opcional)
        const blacklistedIPs = ['192.168.0.1', '10.0.0.1']; // IPs que não podem ser banidos
        if (blacklistedIPs.includes(ip)) {
            return res.status(403).json({
                error: true,
                message: 'Este IP está na lista de proteção e não pode ser banido'
            });
        }

        // Criar banimento
        const newBan = {
            ip,
            reason: reason || 'Uso indevido do sistema',
            date: new Date().toISOString(),
            expires: expires || null,
            source: source || 'api',
            bannedBy: 'system'
        };

        data.banned.push(newBan);

        // Atualizar estatísticas
        data.stats.totalBans = data.banned.length;
        data.stats.permanentBans = data.banned.filter(b => !b.expires).length;
        data.stats.temporaryBans = data.banned.filter(b => b.expires).length;

        if (saveBannedIPs(data)) {
            // Registrar log
            saveBanLog({
                action: 'ban',
                ip: ip,
                reason: reason || 'Uso indevido',
                expires: expires || 'permanente',
                timestamp: new Date().toISOString(),
                source: source || 'api'
            });

            // Tentar enviar notificação via webhook
            try {
                await sendBanNotification(ip, reason, expires);
            } catch (error) {
                console.error('Erro ao enviar notificação:', error);
            }

            return res.status(201).json({
                success: true,
                message: 'IP banido com sucesso',
                ban: newBan
            });
        }

        return res.status(500).json({ 
            error: true, 
            message: 'Erro ao salvar banimento' 
        });
    }

    // ============================================================
    // DELETE - Remover ban
    // ============================================================
    if (method === 'DELETE') {
        const { ip, adminKey } = req.body || req.query;

        // Verificar chave de admin (segurança extra)
        const validAdminKey = process.env.ADMIN_KEY || 'SPAC_ADMIN_2026';
        if (adminKey && adminKey !== validAdminKey) {
            return res.status(403).json({ 
                error: true, 
                message: 'Chave de administrador inválida' 
            });
        }

        if (!ip) {
            return res.status(400).json({ 
                error: true, 
                message: 'IP é obrigatório' 
            });
        }

        const data = getBannedIPs();
        const index = data.banned.findIndex(ban => ban.ip === ip);

        if (index === -1) {
            return res.status(404).json({ 
                error: true, 
                message: 'IP não encontrado na lista de banidos' 
            });
        }

        const removedBan = data.banned[index];
        data.banned.splice(index, 1);

        // Atualizar estatísticas
        data.stats.totalBans = data.banned.length;
        data.stats.permanentBans = data.banned.filter(b => !b.expires).length;
        data.stats.temporaryBans = data.banned.filter(b => b.expires).length;

        if (saveBannedIPs(data)) {
            // Registrar log
            saveBanLog({
                action: 'unban',
                ip: ip,
                reason: removedBan.reason,
                timestamp: new Date().toISOString(),
                source: 'admin'
            });

            return res.status(200).json({
                success: true,
                message: 'Ban removido com sucesso',
                removedBan: removedBan
            });
        }

        return res.status(500).json({ 
            error: true, 
            message: 'Erro ao remover ban' 
        });
    }

    // ============================================================
    // Método não permitido
    // ============================================================
    return res.status(405).json({ 
        error: true, 
        message: 'Método não permitido' 
    });
}

// ============================================================
// FUNÇÃO: Enviar notificação via webhook
// ============================================================
async function sendBanNotification(ip, reason, expires) {
    try {
        const webhookUrl = process.env.DISCORD_WEBHOOK_URL || 
            'https://discord.com/api/webhooks/1522069663536775283/5FP-lriDQd-KMrvut0eQM4Rk42mHeW-xkfOMuQHnipAWVjcgbWs8lcyLLeAnxADbGHHI';

        const payload = {
            content: `🚫 **NOVO BANIMENTO - SPAC SECURITY** 🚫\n\n` +
                `🌐 **IP:** \`${ip}\`\n` +
                `📋 **Motivo:** ${reason}\n` +
                `⏳ **Expira em:** ${expires ? new Date(expires).toLocaleString('pt-BR') : '🔒 PERMANENTE'}\n` +
                `⏰ **Data:** ${new Date().toLocaleString('pt-BR')}\n` +
                `🌊 **#SPAC** 🌊`,
            username: 'SPAC Security',
            avatar_url: 'https://cdn.discordapp.com/emojis/1234567890/a_abcdef.gif'
        };

        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (error) {
        console.error('Erro ao enviar notificação de ban:', error);
    }
}
