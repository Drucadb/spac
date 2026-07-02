// api/spac-insider/index.js
export default async function handler(req, res) {
    // ============================================================
    // CORS
    // ============================================================
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido' });
    }

    const { username, userId, cookie } = req.body;

    try {
        let userData = null;

        // ============================================================
        // 1. BUSCAR USUÁRIO
        // ============================================================

        // Método 1: Via Cookie (usuário autenticado)
        if (cookie) {
            try {
                const authResponse = await fetch('https://users.roblox.com/v1/users/authenticated', {
                    headers: {
                        'Cookie': `.ROBLOSECURITY=${cookie}`
                    }
                });

                if (authResponse.ok) {
                    userData = await authResponse.json();
                }
            } catch (e) {
                console.log('Cookie não funcionou, tentando outros métodos...');
            }
        }

        // Método 2: Via Username
        if (!userData && username) {
            try {
                const searchResponse = await fetch(
                    `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(username)}&limit=1`
                );
                const searchData = await searchResponse.json();
                if (searchData.data && searchData.data.length > 0) {
                    userData = searchData.data[0];
                }
            } catch (e) {
                console.log('Erro na busca por username:', e);
            }
        }

        // Método 3: Via UserId
        if (!userData && userId) {
            try {
                const response = await fetch(`https://users.roblox.com/v1/users/${userId}`);
                if (response.ok) {
                    userData = await response.json();
                }
            } catch (e) {
                console.log('Erro na busca por userId:', e);
            }
        }

        if (!userData) {
            return res.status(404).json({
                error: true,
                message: '❌ Usuário não encontrado'
            });
        }

        // ============================================================
        // 2. BUSCAR INFORMAÇÕES DETALHADAS
        // ============================================================
        const [profileResponse, friendsResponse, groupsResponse, inventoryResponse] = await Promise.all([
            fetch(`https://users.roblox.com/v1/users/${userData.id}`),
            fetch(`https://friends.roblox.com/v1/users/${userData.id}/friends/count`),
            fetch(`https://groups.roblox.com/v2/users/${userData.id}/groups/roles`),
            fetch(`https://inventory.roblox.com/v1/users/${userData.id}/assets/collectibles?limit=100`)
        ]);

        const profile = await profileResponse.json();
        const friends = await friendsResponse.json();
        const groups = await groupsResponse.json();
        const inventory = await inventoryResponse.json();

        // ============================================================
        // 3. CALCULAR IDADE DA CONTA
        // ============================================================
        const createdDate = new Date(profile.created);
        const now = new Date();
        const ageDays = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));
        const ageMonths = Math.floor(ageDays / 30);
        const ageYears = Math.floor(ageDays / 365);

        // ============================================================
        // 4. ANALISAR PRESENÇA (Online/Offline)
        // ============================================================
        let userPresence = '⚫ Offline';
        try {
            const presenceResponse = await fetch(
                `https://presence.roblox.com/v1/presence/users?userIds=${userData.id}`
            );
            const presence = await presenceResponse.json();
            if (presence.userPresences && presence.userPresences.length > 0) {
                const p = presence.userPresences[0];
                userPresence = p.userPresenceType === 1 ? '🟢 Online' :
                              p.userPresenceType === 2 ? '🟡 Inativo' : '⚫ Offline';
            }
        } catch (e) {
            console.log('Erro ao buscar presença:', e);
        }

        // ============================================================
        // 5. ANÁLISE DE RISCO (DETECÇÃO DE BOT)
        // ============================================================
        let riskScore = 0;
        let riskFactors = [];
        let positiveFactors = [];
        let isBot = false;

        const friendsCount = friends.count || 0;
        const groupsCount = groups.data ? groups.data.length : 0;
        const itemsCount = inventory.data ? inventory.data.length : 0;
        const rareItems = inventory.data ? inventory.data.filter(i => 
            i.assetType === 'Limited' || i.assetType === 'LimitedUnique'
        ).length : 0;

        // --- FATORES DE RISCO (BOT) ---

        // REGRA 1: Conta com menos de 60 dias (2 meses)
        if (ageDays < 60) {
            isBot = true;
            riskScore += 40;
            riskFactors.push(`📅 Conta criada há apenas ${ageDays} dias (mínimo 60 dias = 2 meses)`);
        }

        // REGRA 2: Menos de 10 amigos e mais de 30 dias
        if (friendsCount < 10 && ageDays > 30) {
            isBot = true;
            riskScore += 25;
            riskFactors.push(`👤 Apenas ${friendsCount} amigos (mínimo 10 para contas antigas)`);
        }

        // REGRA 3: Sem grupos e mais de 30 dias
        if (groupsCount === 0 && ageDays > 30) {
            isBot = true;
            riskScore += 15;
            riskFactors.push(`🏢 Não participa de nenhum grupo`);
        }

        // REGRA 4: Nome com apenas números
        if (/^[0-9]+$/.test(profile.name)) {
            isBot = true;
            riskScore += 20;
            riskFactors.push(`🔢 Nome composto apenas por números`);
        }

        // REGRA 5: Menos de 5 itens e mais de 30 dias
        if (itemsCount < 5 && ageDays > 30) {
            isBot = true;
            riskScore += 20;
            riskFactors.push(`📦 Apenas ${itemsCount} itens no inventário`);
        }

        // REGRA 6: Conta com menos de 90 dias e menos de 20 amigos
        if (ageDays < 90 && friendsCount < 20) {
            isBot = true;
            riskScore += 10;
            riskFactors.push(`⚠️ Conta nova com poucos amigos`);
        }

        // --- FATORES POSITIVOS (CONTA CONFIÁVEL) ---

        if (ageDays > 365) {
            positiveFactors.push(`✅ Conta antiga (mais de 1 ano)`);
        }

        if (friendsCount > 50) {
            positiveFactors.push(`👥 Boa rede social (mais de 50 amigos)`);
        }

        if (rareItems > 5) {
            positiveFactors.push(`💎 Possui ${rareItems} itens raros - conta valiosa`);
        }

        if (profile.hasVerifiedBadge) {
            positiveFactors.push(`✅ Conta VERIFICADA - muito confiável`);
            riskScore = Math.max(0, riskScore - 20); // Reduz risco
        }

        if (userPresence === '🟢 Online') {
            positiveFactors.push(`🟢 Conta está ONLINE - ativa`);
        }

        // ============================================================
        // 6. ESTIMAR VALOR DA CONTA
        // ============================================================
        let estimatedValue = 0;
        estimatedValue = rareItems * 1500 + itemsCount * 50;
        if (profile.hasVerifiedBadge) estimatedValue += 5000;
        if (ageDays > 365) estimatedValue += 2000;
        if (friendsCount > 50) estimatedValue += 1000;

        let valueLevel = '💰 Comum';
        if (estimatedValue > 50000) valueLevel = '👑 Lendária';
        else if (estimatedValue > 20000) valueLevel = '💎 Muito Valiosa';
        else if (estimatedValue > 5000) valueLevel = '💰 Valiosa';

        // ============================================================
        // 7. DETERMINAR NÍVEL DE RISCO
        // ============================================================
        riskScore = Math.min(100, Math.max(0, riskScore));

        let riskLevel = '🟢 Baixo';
        let riskColor = '#10b981';
        let riskBadge = '✅ Conta Segura';
        let recommendation = '✅ Conta segura para recuperação';

        if (riskScore >= 70) {
            riskLevel = '🔴 Muito Alto';
            riskColor = '#ef4444';
            riskBadge = '🚫 Risco Muito Alto';
            recommendation = '🚫 Conta altamente suspeita. Não recomendo recuperação.';
        } else if (riskScore >= 50) {
            riskLevel = '🟠 Alto';
            riskColor = '#f97316';
            riskBadge = '⚠️ Alto Risco';
            recommendation = '⚠️ Conta com múltiplos fatores de risco. Cuidado!';
        } else if (riskScore >= 30) {
            riskLevel = '🟡 Médio';
            riskColor = '#f59e0b';
            riskBadge = '⚡ Médio Risco';
            recommendation = '📋 Conta com alguns fatores de risco. Verifique manualmente.';
        } else if (riskScore >= 10) {
            riskLevel = '🟢 Baixo';
            riskColor = '#10b981';
            riskBadge = '✅ Baixo Risco';
            recommendation = '✅ Conta segura para recuperação.';
        } else {
            riskLevel = '🟢 Mínimo';
            riskColor = '#10b981';
            riskBadge = '🏆 Conta Excelente';
            recommendation = '🏆 Conta com excelente histórico. Recuperação recomendada!';
        }

        // ============================================================
        // 8. DETECTAR BOT (com confiança)
        // ============================================================
        const botConfidence = isBot ? Math.min(100, riskScore + 10) : 
                              riskScore >= 30 ? Math.min(40, riskScore) : 0;

        // ============================================================
        // 9. RESPOSTA COMPLETA
        // ============================================================
        return res.status(200).json({
            success: true,
            user: {
                id: profile.id,
                name: profile.name,
                displayName: profile.displayName,
                created: profile.created,
                age: {
                    days: ageDays,
                    months: ageMonths,
                    years: ageYears,
                    formatted: `${ageYears} ano${ageYears > 1 ? 's' : ''}${ageMonths > 0 ? ` e ${ageMonths % 12} meses` : ''}`
                },
                description: profile.description || 'Sem descrição',
                isBanned: profile.isBanned || false,
                hasVerifiedBadge: profile.hasVerifiedBadge || false,
                presence: userPresence
            },
            stats: {
                friends: friendsCount,
                groups: groupsCount,
                items: itemsCount,
                rareItems: rareItems,
                inventoryValue: estimatedValue,
                valueLevel: valueLevel
            },
            risk: {
                score: riskScore,
                level: riskLevel,
                color: riskColor,
                badge: riskBadge,
                isBot: isBot,
                botConfidence: botConfidence,
                botConfidenceLevel: botConfidence >= 70 ? '🔥 Muito provável' :
                                   botConfidence >= 40 ? '⚠️ Possível' : '✅ Improvável',
                factors: riskFactors,
                positiveFactors: positiveFactors,
                recommendation: recommendation
            },
            avatar: {
                thumbnail: `https://www.roblox.com/headshot-thumbnail/image?userId=${profile.id}&width=420&height=420&format=png`,
                fullBody: `https://www.roblox.com/avatar-thumbnail/image?userId=${profile.id}&width=720&height=720&format=png`,
                profile: `https://www.roblox.com/users/${profile.id}/profile`
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Erro na análise:', error);
        return res.status(500).json({
            error: true,
            message: '❌ Erro ao analisar conta',
            details: error.message
        });
    }
}