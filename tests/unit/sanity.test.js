describe('Sanity Check', () => {
    test('global.chrome should be defined', () => {
        expect(global.chrome).toBeDefined();
        expect(global.chrome.runtime).toBeDefined();
    });
});
