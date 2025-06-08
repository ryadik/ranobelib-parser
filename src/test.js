import promptSync from 'prompt-sync';

const prompt = promptSync({ sigint: true });

console.log('test input');

const testInput = prompt();

console.log(`testInput: ${testInput}`);
