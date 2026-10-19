import { ScriptService } from '../../src/modules/services/ScriptService.js';

test('script storage remains compatible with the editor', async () => {
    const scripts = { preRequestScript: 'console.log(1)', testScript: 'pm.test("ok", () => {})' };
    const repository = { getScripts: jest.fn().mockResolvedValue(scripts), saveScripts: jest.fn() };
    const service = new ScriptService(repository);
    expect(await service.getScripts('c', 'r')).toEqual(scripts);
    await service.saveScripts('c', 'r', scripts);
    expect(repository.saveScripts).toHaveBeenCalledWith('c', 'r', scripts);
    repository.saveScripts.mockRejectedValue(new Error('disk full'));
    await expect(service.saveScripts('c', 'r', scripts)).rejects.toThrow('disk full');
    repository.getScripts.mockRejectedValue(new Error('not found'));
    expect(await service.getScripts('c', 'r')).toEqual({ preRequestScript: '', testScript: '' });
});
