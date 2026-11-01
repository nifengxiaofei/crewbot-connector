import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  platform: 'node',
  format: 'esm',
  // 压缩：去掉注释、缩短局部变量名，体积更小；不生成 source map
  minify: true,
  sourcemap: false,
  // @crewbot/protocol 不发布到 npm，打进产物；第三方包作为 dependencies 由 npm 安装
  // （各自带着许可证）。agent 适配器运行时按需安装，见 src/adapters.ts
  deps: { alwaysBundle: [/^@crewbot\//] },
});
