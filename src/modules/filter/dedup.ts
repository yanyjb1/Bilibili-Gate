import { baseDebug } from '$common'
import { settings } from '$modules/settings'

const debug = baseDebug.extend('modules:filter:dedup')

const STORAGE_KEY = 'filter.dedup.seen-bvids'
const DEFAULT_MAX_ENTRIES = 5000

/**
 * 「曾经推荐过」的 bvid 持久化集合.
 *
 * - GM storage: 跨会话持久
 * - FIFO 裁剪: 超过 maxEntries 丢弃最旧的, 避免 storage 无限膨胀
 * - 内存缓存: has() 是同步热路径, GM 读取只在启动时发生一次
 */
class SeenBvidStore {
  private seen = new Set<string>()
  private order: string[] = [] // 插入顺序, 用于 FIFO 裁剪
  private loaded = false
  private loadPromise: Promise<void> | undefined

  async load() {
    this.loadPromise ??= (async () => {
      try {
        const val: unknown = await GM.getValue(STORAGE_KEY)
        if (Array.isArray(val)) {
          for (const bvid of val) {
            if (typeof bvid === 'string' && bvid) {
              this.seen.add(bvid)
              this.order.push(bvid)
            }
          }
          this.trim()
        }
      } catch (e) {
        debug('load failed: %o', e)
      } finally {
        this.loaded = true
        debug('loaded %s entries', this.seen.size)
      }
    })()
    return this.loadPromise
  }

  private get maxEntries() {
    return settings.filter.dedup.maxEntries || DEFAULT_MAX_ENTRIES
  }

  private trim() {
    while (this.order.length > this.maxEntries) {
      const oldest = this.order.shift()
      if (oldest) this.seen.delete(oldest)
    }
  }

  private persist() {
    GM.setValue(STORAGE_KEY, [...this.order]).catch((e: unknown) => debug('persist failed: %o', e))
  }

  /** 是否见过; 未加载完成时返回 false(宁可漏放也不误杀) */
  has(bvid?: string) {
    if (!bvid) return false
    return this.seen.has(bvid)
  }

  async addMany(bvids: (string | undefined)[]) {
    await this.load()
    let added = false
    for (const bvid of bvids) {
      if (!bvid || this.seen.has(bvid)) continue
      this.seen.add(bvid)
      this.order.push(bvid)
      added = true
    }
    if (added) {
      this.trim()
      this.persist()
      debug('addMany: +size=%s total=%s', bvids.length, this.seen.size)
    }
  }

  async clear() {
    await this.load()
    this.seen.clear()
    this.order = []
    this.persist()
    debug('cleared')
  }

  get size() {
    return this.seen.size
  }

  get isLoaded() {
    return this.loaded
  }
}

export const seenBvidStore = new SeenBvidStore()
void seenBvidStore.load()
