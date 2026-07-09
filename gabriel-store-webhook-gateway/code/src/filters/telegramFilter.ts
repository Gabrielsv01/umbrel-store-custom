function telegramFilter(payload: any, config: any, _headers: any): boolean {
    const message = payload?.message || payload?.my_chat_member;

    const authorizedChatIds: string[] = config.authorizedChatIds ?? [];
    const authorizedUsernames: string[] = config.authorizedUsernames ?? [];

    // Fail-closed: sem nenhuma allowlist configurada, nega a requisição.
    if (authorizedChatIds.length === 0 && authorizedUsernames.length === 0) {
        return false;
    }

    const chatId = message?.chat?.id;
    const isChatAuthorized = chatId !== undefined && chatId !== null
        && authorizedChatIds.includes(chatId.toString());

    const username = message?.from?.username;
    const isUserAuthorized = Boolean(username) && authorizedUsernames.includes(username);

    return isChatAuthorized || isUserAuthorized;
}

export default telegramFilter;