import { log, logWarn, logError, isExtensionContextValid } from './utils.js';
import { csrfToken } from './api.js';
import { getSettings } from './settings.js'; 

const MINE_HIT_URL = "https://mangabuff.ru/mine/hit";

const sendMineHitRequest = async () => {
    if (!isExtensionContextValid()) throw new Error("Extension context lost");
    if (!csrfToken) throw new Error("CSRF token is missing");
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'mineHit',
            url: MINE_HIT_URL,
            csrfToken: csrfToken
        });
        if (!response) { throw new Error(`No response received...`); }
        if (!response.success) {
            const error = new Error(response.error || 'Unknown background error');
            error.status = response.status;
            error.data = response.data;
            throw error;
        }
        return response.data;
    } catch (error) {
        logError(`Error sending message for action mineHit:`, error);
        throw error;
    }
};

export const startMiningProcess = async (updateButtonStateCallback, updateCounterCallback) => {

    const settings = await getSettings();
    const hitsToSend = settings.mineHitCount; 

    log(`🚀 Starting mining burst of ${hitsToSend} hits...`);

    updateCounterCallback(0, hitsToSend, `Отправка ${hitsToSend} ударов...`);
    updateButtonStateCallback(true);

    const hitPromises = [];
    for (let i = 0; i < hitsToSend; i++) { 
        hitPromises.push(sendMineHitRequest());
    }

    log(`Initiated ${hitPromises.length} hit requests.`);

    const results = await Promise.allSettled(hitPromises);
    log(`Finished processing all ${results.length} hit requests.`);

    let successfulHits = 0;
    let firstErrorMessage = null;
    let rateLimitHit = false;

    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            successfulHits++;
        } else {
            logWarn(`❌ Hit ${index + 1} failed. Reason:`, result.reason?.message || result.reason);
            if (!firstErrorMessage) {
                firstErrorMessage = result.reason?.message || 'Неизвестная ошибка';
            }
            if (result.reason?.status === 403 || result.reason?.status === 429 || result.reason?.message?.includes('closed') || result.reason?.message?.includes('закрыта')) {
                 rateLimitHit = true;
            }
        }
    });

    log(`📊 Mining burst result: ${successfulHits} successful / ${hitsToSend - successfulHits} failed.`); 

    let finalMessage = '';
    if (successfulHits === hitsToSend) { 
        finalMessage = `✔️ Успешно (${successfulHits}/${hitsToSend})`; 
    } else if (rateLimitHit) {
        finalMessage = `❌ Шахта закрыта (${successfulHits}/${hitsToSend})`; 
    } else if (successfulHits > 0) {
        finalMessage = `⚠️ Частично (${successfulHits}/${hitsToSend}). Ошибка: ${firstErrorMessage}`; 
    } else {
        finalMessage = `❌ Ошибка (${successfulHits}/${hitsToSend}): ${firstErrorMessage}`; 
    }

    updateButtonStateCallback(false);
    updateCounterCallback(successfulHits, hitsToSend, finalMessage); 
};