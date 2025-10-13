import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

export default {
  packagerConfig: {
    asar: true,
    icon: './assets/icons/icon', // Will use icon.icns (macOS), icon.ico (Windows)
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        // Windows Squirrel installer
        iconUrl: 'https://raw.githubusercontent.com/yourusername/resonance/main/assets/icons/icon.ico',
        setupIcon: './assets/icons/icon.ico',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          icon: './assets/icons/icon.png',
        },
      },
    },
    {
      name: '@electron-forge/maker-flatpak',
      config: {
        options: {
          id: 'com.dbmobile.resonance',
          productName: 'Resonance',
          genericName: 'API Client',
          description: 'A clean and minimal API client with excellent user experience',
          categories: ['Development', 'Network'],
          icon: {
            '512x512': './assets/icons/icon.png'
          },
          files: [],
          symlinks: [],
          finishArgs: [
            '--share=ipc',
            '--socket=wayland',
            '--socket=fallback-x11',
            '--share=network',
            '--device=dri',
            '--filesystem=xdg-documents'
          ],
          modules: [],
          branch: 'stable',
          runtime: 'org.freedesktop.Platform',
          runtimeVersion: '24.08',
          sdk: 'org.freedesktop.Sdk',
          base: 'org.electronjs.Electron2.BaseApp',
          baseVersion: '24.08'
        }
      }
    }
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
