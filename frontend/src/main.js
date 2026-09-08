import { createApp } from 'vue'
import router from './router'
import pinia from './store'
import App from './App.vue'

import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIcons from '@element-plus/icons-vue'

import 'element-plus/dist/index.css'
import './styles/index.css'

const app = createApp(App)

app.use(pinia)
app.use(router)
app.use(ElementPlus, { locale: zhCn, size: 'default' })

// 全局注册 Element Plus 图标，模板中可直接使用 <Plus /> 等组件
Object.entries(ElementPlusIcons).forEach(([name, comp]) => {
  app.component(name, comp)
})

app.mount('#app')
