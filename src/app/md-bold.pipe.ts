import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'mdBold',
  standalone: true,
})
export class MdBoldPipe implements PipeTransform {
  transform(input: string | null | undefined): string {
    if (!input) return '';
    // Escape HTML first so only our <strong> gets through.
    let s = input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Convert **bold** → <strong>bold</strong> (non-greedy, supports multiples)
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Optional: line breaks → <br>
    s = s.replace(/\n/g, '<br>');

    return s; // Angular will still sanitize, but <strong> is allowed
  }
}
