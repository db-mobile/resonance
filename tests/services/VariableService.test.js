import { VariableService } from '../../src/modules/services/VariableService.js';

describe('VariableService', () => {
    let service;
    let mockRepository;
    let mockProcessor;
    let mockStatusDisplay;

    beforeEach(() => {
        mockRepository = {
            getVariablesForCollection: jest.fn(),
            setVariable: jest.fn(),
            deleteVariable: jest.fn(),
            setVariablesForCollection: jest.fn(),
            deleteAllVariablesForCollection: jest.fn()
        };

        mockProcessor = {
            isValidVariableName: jest.fn(),
            processObject: jest.fn(),
            processTemplate: jest.fn(),
            getPreview: jest.fn(),
            extractVariableNamesFromObject: jest.fn()
        };

        mockStatusDisplay = {
            update: jest.fn()
        };

        service = new VariableService(mockRepository, mockProcessor, mockStatusDisplay);
    });

    describe('getVariablesForCollection', () => {
        test('should return variables from repository', async () => {
            const expectedVariables = { apiKey: 'test-key', baseUrl: 'https://api.example.com' };
            mockRepository.getVariablesForCollection.mockResolvedValue(expectedVariables);

            const result = await service.getVariablesForCollection('collection-1');

            expect(result).toEqual(expectedVariables);
            expect(mockRepository.getVariablesForCollection).toHaveBeenCalledWith('collection-1');
        });

        test('should handle errors and update status', async () => {
            const error = new Error('Database error');
            mockRepository.getVariablesForCollection.mockRejectedValue(error);

            await expect(service.getVariablesForCollection('collection-1')).rejects.toThrow('Database error');
            expect(mockStatusDisplay.update).toHaveBeenCalledWith('Error loading variables: Database error', null);
        });
    });

    describe('setVariable', () => {
        test('should set valid variable', async () => {
            mockProcessor.isValidVariableName.mockReturnValue(true);
            mockRepository.setVariable.mockResolvedValue();

            const result = await service.setVariable('collection-1', 'apiKey', 'test-key');

            expect(result).toBe(true);
            expect(mockProcessor.isValidVariableName).toHaveBeenCalledWith('apiKey');
            expect(mockRepository.setVariable).toHaveBeenCalledWith('collection-1', 'apiKey', 'test-key');
            expect(mockStatusDisplay.update).toHaveBeenCalledWith('Variable "apiKey" saved', null);
        });

        test('should reject invalid variable names', async () => {
            mockProcessor.isValidVariableName.mockReturnValue(false);

            await expect(service.setVariable('collection-1', '123invalid', 'value')).rejects.toThrow('Invalid variable name: 123invalid');
            expect(mockRepository.setVariable).not.toHaveBeenCalled();
        });

        test('should handle repository errors', async () => {
            mockProcessor.isValidVariableName.mockReturnValue(true);
            mockRepository.setVariable.mockRejectedValue(new Error('Save error'));

            await expect(service.setVariable('collection-1', 'apiKey', 'value')).rejects.toThrow('Save error');
            expect(mockStatusDisplay.update).toHaveBeenCalledWith('Error saving variable: Save error', null);
        });
    });

    describe('deleteVariable', () => {
        test('should delete variable successfully', async () => {
            mockRepository.deleteVariable.mockResolvedValue();

            const result = await service.deleteVariable('collection-1', 'apiKey');

            expect(result).toBe(true);
            expect(mockRepository.deleteVariable).toHaveBeenCalledWith('collection-1', 'apiKey');
            expect(mockStatusDisplay.update).toHaveBeenCalledWith('Variable "apiKey" deleted', null);
        });

        test('should handle deletion errors', async () => {
            mockRepository.deleteVariable.mockRejectedValue(new Error('Delete error'));

            await expect(service.deleteVariable('collection-1', 'apiKey')).rejects.toThrow('Delete error');
            expect(mockStatusDisplay.update).toHaveBeenCalledWith('Error deleting variable: Delete error', null);
        });
    });

    describe('setMultipleVariables', () => {
        test('should set multiple valid variables', async () => {
            const variables = { apiKey: 'key1', baseUrl: 'url1' };
            mockProcessor.isValidVariableName.mockReturnValue(true);
            mockRepository.setVariablesForCollection.mockResolvedValue();

            const result = await service.setMultipleVariables('collection-1', variables);

            expect(result).toBe(true);
            expect(mockProcessor.isValidVariableName).toHaveBeenCalledWith('apiKey');
            expect(mockProcessor.isValidVariableName).toHaveBeenCalledWith('baseUrl');
            expect(mockRepository.setVariablesForCollection).toHaveBeenCalledWith('collection-1', variables);
            expect(mockStatusDisplay.update).toHaveBeenCalledWith('Variables saved successfully', null);
        });

        test('should reject if any variable name is invalid', async () => {
            const variables = { apiKey: 'key1', '123invalid': 'value' };
            mockProcessor.isValidVariableName.mockImplementation(name => name !== '123invalid');

            await expect(service.setMultipleVariables('collection-1', variables)).rejects.toThrow('Invalid variable name: 123invalid');
            expect(mockRepository.setVariablesForCollection).not.toHaveBeenCalled();
        });
    });

    describe('processRequest', () => {
        test('should process request with variables', async () => {
            const request = { url: 'https://{{ baseUrl }}/api' };
            const variables = { baseUrl: 'api.example.com' };
            const processedRequest = { url: 'https://api.example.com/api' };

            mockRepository.getVariablesForCollection.mockResolvedValue(variables);
            mockProcessor.processObject.mockReturnValue(processedRequest);

            const result = await service.processRequest(request, 'collection-1');

            expect(result).toEqual(processedRequest);
            expect(mockRepository.getVariablesForCollection).toHaveBeenCalledWith('collection-1');
            expect(mockProcessor.processObject).toHaveBeenCalledWith(request, variables);
        });

        test('should return original request if processing fails', async () => {
            const request = { url: 'https://{{ baseUrl }}/api' };
            mockRepository.getVariablesForCollection.mockRejectedValue(new Error('Error'));

            const result = await service.processRequest(request, 'collection-1');

            expect(result).toEqual(request);
        });
    });

    describe('processTemplate', () => {
        test('should process template with variables', async () => {
            const template = 'Hello {{ name }}!';
            const variables = { name: 'World' };
            const processedTemplate = 'Hello World!';

            mockRepository.getVariablesForCollection.mockResolvedValue(variables);
            mockProcessor.processTemplate.mockReturnValue(processedTemplate);

            const result = await service.processTemplate(template, 'collection-1');

            expect(result).toBe(processedTemplate);
            expect(mockProcessor.processTemplate).toHaveBeenCalledWith(template, variables);
        });

        test('should return original template if processing fails', async () => {
            const template = 'Hello {{ name }}!';
            mockRepository.getVariablesForCollection.mockRejectedValue(new Error('Error'));

            const result = await service.processTemplate(template, 'collection-1');

            expect(result).toBe(template);
        });
    });

    describe('getTemplatePreview', () => {
        test('should get template preview', async () => {
            const template = 'Hello {{ name }}!';
            const variables = { name: 'World' };
            const preview = { preview: 'Hello World!', missingVariables: [], foundVariables: ['name'] };

            mockRepository.getVariablesForCollection.mockResolvedValue(variables);
            mockProcessor.getPreview.mockReturnValue(preview);

            const result = await service.getTemplatePreview(template, 'collection-1');

            expect(result).toEqual(preview);
            expect(mockProcessor.getPreview).toHaveBeenCalledWith(template, variables);
        });

        test('should return default preview if processing fails', async () => {
            const template = 'Hello {{ name }}!';
            mockRepository.getVariablesForCollection.mockRejectedValue(new Error('Error'));

            const result = await service.getTemplatePreview(template, 'collection-1');

            expect(result).toEqual({ preview: template, missingVariables: [], foundVariables: [] });
        });
    });

    describe('findUsedVariables', () => {
        test('should find used variables in request', () => {
            const request = { url: 'https://{{ baseUrl }}/{{ path }}' };
            const expectedVariables = ['baseUrl', 'path'];
            mockProcessor.extractVariableNamesFromObject.mockReturnValue(expectedVariables);

            const result = service.findUsedVariables(request);

            expect(result).toEqual(expectedVariables);
            expect(mockProcessor.extractVariableNamesFromObject).toHaveBeenCalledWith(request);
        });
    });

    describe('cleanupCollectionVariables', () => {
        test('should cleanup variables for collection', async () => {
            mockRepository.deleteAllVariablesForCollection.mockResolvedValue();

            await service.cleanupCollectionVariables('collection-1');

            expect(mockRepository.deleteAllVariablesForCollection).toHaveBeenCalledWith('collection-1');
        });

        test('should handle cleanup errors gracefully', async () => {
            mockRepository.deleteAllVariablesForCollection.mockRejectedValue(new Error('Cleanup error'));
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

            await service.cleanupCollectionVariables('collection-1');

            expect(consoleSpy).toHaveBeenCalledWith('Error cleaning up collection variables:', expect.any(Error));
            consoleSpy.mockRestore();
        });
    });

    describe('exportVariables', () => {
        test('should export variables for collection', async () => {
            const variables = { apiKey: 'key1', baseUrl: 'url1' };
            mockRepository.getVariablesForCollection.mockResolvedValue(variables);

            const result = await service.exportVariables('collection-1');

            expect(result).toEqual(variables);
            expect(mockRepository.getVariablesForCollection).toHaveBeenCalledWith('collection-1');
        });
    });

    describe('importVariables', () => {
        test('should import variables without merge', async () => {
            const variables = { apiKey: 'key1', baseUrl: 'url1' };
            mockProcessor.isValidVariableName.mockReturnValue(true);
            mockRepository.setVariablesForCollection.mockResolvedValue();

            const result = await service.importVariables('collection-1', variables, false);

            expect(result).toBe(true);
            expect(mockRepository.setVariablesForCollection).toHaveBeenCalledWith('collection-1', variables);
        });

        test('should import variables with merge', async () => {
            const existingVariables = { apiKey: 'old-key' };
            const newVariables = { baseUrl: 'new-url' };
            const mergedVariables = { apiKey: 'old-key', baseUrl: 'new-url' };

            mockRepository.getVariablesForCollection.mockResolvedValue(existingVariables);
            mockProcessor.isValidVariableName.mockReturnValue(true);
            mockRepository.setVariablesForCollection.mockResolvedValue();

            const result = await service.importVariables('collection-1', newVariables, true);

            expect(result).toBe(true);
            expect(mockRepository.setVariablesForCollection).toHaveBeenCalledWith('collection-1', mergedVariables);
        });

        test('should handle import errors', async () => {
            const variables = { apiKey: 'key1' };
            mockProcessor.isValidVariableName.mockReturnValue(false);

            await expect(service.importVariables('collection-1', variables)).rejects.toThrow('Invalid variable name: apiKey');
            expect(mockStatusDisplay.update).toHaveBeenCalledWith('Error importing variables: Invalid variable name: apiKey', null);
        });
    });
});
