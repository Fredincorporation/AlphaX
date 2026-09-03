process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

(async () => {
	await import('../dist/server/index.js');
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
