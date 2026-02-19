let privacyMode = $state(false);

export function isPrivate(): boolean {
	return privacyMode;
}

export function togglePrivacy(): void {
	privacyMode = !privacyMode;
}

export function maskAddr(addr: string | undefined | null): string {
	if (!addr) return '';
	if (!privacyMode) return addr;
	return '••••••••••••••••';
}
