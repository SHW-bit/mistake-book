
import io
PATH = "tests/test_client_render.mjs"
s = io.open(PATH, encoding="utf-8").read()
orig = len(s)

# dropdownLabels 需要「未展开的 vnode 树」：render() 之后 Dropdown 已经展开成按钮，
# props.options 不再存在，所以这里不 render，直接喂 ListTab 的返回值。
a = """  const dom = render(plugin.__test__.ListTab({ meta: META_FACETS, onOpen: () => {} }));
  const labels = dropdownLabels(dom);"""
b = """  const labels = dropdownLabels(plugin.__test__.ListTab({ meta: META_FACETS, onOpen: () => {} }));"""
assert s.count(a) == 1
s = s.replace(a, b)

a = """  const dom = render(plugin.__test__.ListTab({ meta: META, onOpen: () => {} }));
  const labels = dropdownLabels(dom);"""
b = """  const labels = dropdownLabels(plugin.__test__.ListTab({ meta: META, onOpen: () => {} }));"""
assert s.count(a) == 1
s = s.replace(a, b)

io.open(PATH, "w", encoding="utf-8", newline="\n").write(s)
print("patched %d -> %d" % (orig, len(s)))
