const fs = require('fs');
const path = require('path');

exports.default = async function(context) {
  const { appOutDir } = context;

  const filesToRemove = [
    'LICENSES.chromium.html',
    'LICENSE.electron.txt',
    'vk_swiftshader.dll',
    'vk_swiftshader_icd.json',
    'vulkan-1.dll',
    'd3dcompiler_47.dll',
    'dxcompiler.dll',
    'dxil.dll'
  ];

  for (const file of filesToRemove) {
    const filePath = path.join(appOutDir, file);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[afterPack] Removed: ${file}`);
    }
  }
};
