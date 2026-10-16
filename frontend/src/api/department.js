import { request } from './request'

/* ==========================================================================
   组织架构 · 部门管理（管理端，见 SettingsView 部门管理 tab）
   ========================================================================== */

/** 部门树（登录即可读，后续部门选择器/数据范围展示复用） */
export function getDeptTree() {
  return request({ url: '/v1/departments/tree', method: 'get' })
}

/** 新建部门（parentId 为空 = 根部门） */
export function createDepartment(payload) {
  return request({ url: '/v1/departments', method: 'post', data: payload })
}

/** 编辑部门（名称 / 负责人，负责人必须是本部门成员） */
export function updateDepartment(id, payload) {
  return request({ url: `/v1/departments/${id}`, method: 'put', data: payload })
}

/** 移动部门（parentId: null = 移到根级） */
export function moveDepartment(id, parentId) {
  return request({
    url: `/v1/departments/${id}/move`,
    method: 'put',
    data: { parentId }
  })
}

/** 删除部门（需先移出其子部门与成员） */
export function deleteDepartment(id) {
  return request({ url: `/v1/departments/${id}`, method: 'delete' })
}

/** 部门成员分页列表（含用户摘要） */
export function getDeptMembers(id, params = {}) {
  return request({ url: `/v1/departments/${id}/members`, method: 'get', params })
}

/** 指派用户进部门（首次归属自动成为主部门） */
export function addDeptMember(id, payload) {
  return request({ url: `/v1/departments/${id}/members`, method: 'post', data: payload })
}

/** 将用户移出部门（负责人被移出时自动卸任） */
export function removeDeptMember(id, userId) {
  return request({ url: `/v1/departments/${id}/members/${userId}`, method: 'delete' })
}
