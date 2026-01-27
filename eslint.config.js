import js from '@eslint/js';
import globals from 'globals';

export default [
    // Global ignores
    {
        ignores: [
            'dist/**',
            'coverage/**',
            'node_modules/**',
            'src-tauri/target/**',
            '**/*.bundle.js',
            'build.js',
            '*.html',
            'jest.setup.js',
            'test-variables.js'
        ]
    },

    // Base configuration for all JavaScript files
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.es2021
            }
        },
        rules: {
            ...js.configs.recommended.rules,

            // Possible Errors
            'no-console': ['warn', { allow: ['warn', 'error'] }],
            'no-debugger': 'warn',
            'no-duplicate-imports': 'error',
            'no-template-curly-in-string': 'warn',
            'no-unreachable-loop': 'error',

            // Best Practices
            'curly': ['error', 'all'],
            'default-case-last': 'error',
            'eqeqeq': ['error', 'always', { null: 'ignore' }],
            'no-else-return': 'warn',
            'no-empty-function': 'warn',
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-invalid-this': 'error',
            'no-return-await': 'error',
            'no-throw-literal': 'error',
            'no-unused-expressions': 'error',
            'no-useless-concat': 'warn',
            'prefer-promise-reject-errors': 'error',
            'require-await': 'warn',

            // Variables
            'no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrors: 'none'
            }],
            'no-use-before-define': ['error', {
                functions: false,
                classes: true,
                variables: true
            }],

            // Stylistic
            'camelcase': ['warn', { properties: 'never' }],
            'consistent-return': 'warn',
            'max-depth': ['warn', 4],
            'max-nested-callbacks': ['warn', 3],
            'no-lonely-if': 'warn',
            'no-unneeded-ternary': 'warn',
            'prefer-const': 'error',
            'prefer-template': 'warn',
            'quotes': ['error', 'single', { avoidEscape: true }],
            'semi': ['error', 'always'],

            // ES6+
            'arrow-body-style': ['warn', 'as-needed'],
            'no-var': 'error',
            'prefer-arrow-callback': 'warn',
            'prefer-destructuring': ['warn', { object: true, array: false }],
            'prefer-rest-params': 'error',
            'prefer-spread': 'error'
        }
    },


    // Services (Node.js environment)
    {
        files: ['src/services/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.node,
                __dirname: 'readonly',
                __filename: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                console: 'readonly'
            }
        },
        rules: {
            'no-console': 'off'
        }
    },

    // Renderer process (Browser environment)
    {
        files: ['src/renderer.js', 'src/modules/**/*.js', 'src/i18n/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.browser,
                backendAPI: 'readonly',
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                localStorage: 'readonly',
                sessionStorage: 'readonly',
                fetch: 'readonly',
                CustomEvent: 'readonly'
            }
        }
    },

    // Test files
    {
        files: ['tests/**/*.js', '**/*.test.js', '**/__tests__/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.jest,
                describe: 'readonly',
                it: 'readonly',
                test: 'readonly',
                expect: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly',
                beforeAll: 'readonly',
                afterAll: 'readonly',
                jest: 'readonly'
            }
        },
        rules: {
            'no-console': 'off',
            'no-unused-expressions': 'off',
            'max-nested-callbacks': 'off'
        }
    }
];
