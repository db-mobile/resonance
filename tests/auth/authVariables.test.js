import { resolveAuthConfigVariables } from '../../src/modules/auth/authVariables.js';
import { VariableProcessor } from '../../src/modules/variables/VariableProcessor.js';

describe('resolveAuthConfigVariables', () => {
    let processor;

    beforeEach(() => {
        processor = new VariableProcessor();
    });

    test('substitutes variables in basic auth credentials', () => {
        const input = { type: 'basic', config: { username: '{{apiUser}}', password: '{{ apiPass }}' } };

        const { authConfig, unresolved } = resolveAuthConfigVariables(
            input,
            { apiUser: 'ada', apiPass: 'hunter2' },
            processor
        );

        expect(authConfig.config).toEqual({ username: 'ada', password: 'hunter2' });
        expect(unresolved).toEqual([]);
    });

    test('substitutes variables in ntlm and aws configs', () => {
        const ntlm = resolveAuthConfigVariables(
            { type: 'ntlm', config: { username: '{{u}}', password: '{{p}}', domain: 'CORP', workstation: '' } },
            { u: 'ada', p: 'hunter2' },
            processor
        );
        expect(ntlm.authConfig.config).toEqual({
            username: 'ada', password: 'hunter2', domain: 'CORP', workstation: ''
        });

        const aws = resolveAuthConfigVariables(
            { type: 'aws-v4', config: { accessKeyId: '{{awsKey}}', secretAccessKey: '{{awsSecret}}', region: 'eu-central-1' } },
            { awsKey: 'AKIA123', awsSecret: 's3cret' },
            processor
        );
        expect(aws.authConfig.config).toEqual({
            accessKeyId: 'AKIA123', secretAccessKey: 's3cret', region: 'eu-central-1'
        });
    });

    test('reports unresolved variable names and leaves the reference literal', () => {
        const { authConfig, unresolved } = resolveAuthConfigVariables(
            { type: 'basic', config: { username: 'ada', password: '{{missingPass}}' } },
            { other: 'x' },
            processor
        );

        expect(unresolved).toEqual(['missingPass']);
        expect(authConfig.config.password).toBe('{{missingPass}}');
    });

    test('does not mutate the input config', () => {
        const input = { type: 'basic', config: { username: '{{u}}', password: '{{p}}' } };

        resolveAuthConfigVariables(input, { u: 'ada', p: 'hunter2' }, processor);

        expect(input.config).toEqual({ username: '{{u}}', password: '{{p}}' });
    });

    test('passes through untouched without a processor or config', () => {
        const input = { type: 'basic', config: { username: '{{u}}' } };

        expect(resolveAuthConfigVariables(input, { u: 'ada' }, null))
            .toEqual({ authConfig: input, unresolved: [] });
        expect(resolveAuthConfigVariables(null, { u: 'ada' }, processor))
            .toEqual({ authConfig: null, unresolved: [] });
    });

    test('resolves dynamic variables in credential fields', () => {
        const { authConfig } = resolveAuthConfigVariables(
            { type: 'basic', config: { username: '{{$uuid}}', password: 'x' } },
            {},
            processor
        );

        expect(authConfig.config.username).toMatch(/^[0-9a-f-]{36}$/);
        expect(authConfig.config.username).toBe(processor.processTemplate('{{$uuid}}', {}));
    });
});
