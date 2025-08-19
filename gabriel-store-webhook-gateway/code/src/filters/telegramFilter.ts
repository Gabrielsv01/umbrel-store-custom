function telegramFilter(payload: any, config: any, _headers: any) {
    const message = payload.message;
    if (!message?.text) {
        return false;
    }
    const isChatAuthorized = config.authorizedChatIds?.length === 0 || config.authorizedChatIds?.includes(message.chat.id.toString());
    const isUserAuthorized = config.authorizedUsernames?.length === 0 || (message.from?.username && config.authorizedUsernames?.includes(message.from.username));
    return isChatAuthorized || isUserAuthorized;
}

export default telegramFilter;