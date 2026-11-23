const a = []; for (let i = 1; i <= 64; i++) { a.push(Buffer.alloc(16 * 1024 * 1024, 1)); console.log(`allocated ${i * 16}MiB`); }
