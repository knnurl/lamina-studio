// Small DOM helpers shared by the UI modules.

// el('button', { class: 'btn', text: 'Go' }, [children]): 'text' sets textContent, other keys are
// attributes.
export function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === 'text') node.textContent = value;
        else node.setAttribute(key, value);
    }
    for (const child of children) node.append(child);
    return node;
}

// Hands bytes to the browser as a download.
export function save_bytes(name, bytes, type = 'application/octet-stream') {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const link = el('a', { href: url, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
