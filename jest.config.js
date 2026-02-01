module.exports = {
    testEnvironment: 'node',
    setupFilesAfterEnv: ['./tests/unit/setup.js'],
    testMatch: ['**/tests/unit/**/*.test.js'],
    collectCoverage: true,
    coverageDirectory: 'coverage',
    collectCoverageFrom: ['js/**/*.js'],
    moduleNameMapper: {
        // Helper to mock static assets if imported
        '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$': '<rootDir>/tests/mocks/fileMock.js',
        '\\.(css|less)$': '<rootDir>/tests/mocks/styleMock.js'
    }
};
