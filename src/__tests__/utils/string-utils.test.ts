import { cn } from '@/lib/utils';

describe('Utility Functions', () => {
  describe('cn (className utility)', () => {
    it('should combine class names correctly', () => {
      const result = cn('base-class', 'additional-class');
      expect(result).toContain('base-class');
      expect(result).toContain('additional-class');
    });

    it('should handle conditional classes', () => {
      const isActive = true;
      const isDisabled = false;
      
      const result = cn(
        'base-class',
        isActive && 'active',
        isDisabled && 'disabled'
      );
      
      expect(result).toContain('base-class');
      expect(result).toContain('active');
      expect(result).not.toContain('disabled');
    });

    it('should handle undefined and null values', () => {
      const result = cn('base-class', undefined, null, 'valid-class');
      
      expect(result).toContain('base-class');
      expect(result).toContain('valid-class');
    });

    it('should handle empty strings', () => {
      const result = cn('base-class', '', 'valid-class');
      
      expect(result).toContain('base-class');
      expect(result).toContain('valid-class');
    });

    it('should handle arrays of classes', () => {
      const result = cn(['class1', 'class2'], 'class3');
      
      expect(result).toContain('class1');
      expect(result).toContain('class2');
      expect(result).toContain('class3');
    });

    it('should handle objects with conditional classes', () => {
      const result = cn({
        'always-present': true,
        'conditional-true': true,
        'conditional-false': false
      });
      
      expect(result).toContain('always-present');
      expect(result).toContain('conditional-true');
      expect(result).not.toContain('conditional-false');
    });

    it('should handle Tailwind class conflicts', () => {
      // The cn function should use clsx and tailwind-merge to handle conflicts
      const result = cn('p-4', 'p-2');
      
      // Should only contain the last padding class (p-2)
      expect(result).toContain('p-2');
      expect(result).not.toContain('p-4');
    });

    it('should handle responsive classes', () => {
      const result = cn('text-sm', 'md:text-lg', 'lg:text-xl');
      
      expect(result).toContain('text-sm');
      expect(result).toContain('md:text-lg');
      expect(result).toContain('lg:text-xl');
    });

    it('should handle hover and focus states', () => {
      const result = cn(
        'bg-blue-500',
        'hover:bg-blue-600',
        'focus:bg-blue-700',
        'active:bg-blue-800'
      );
      
      expect(result).toContain('bg-blue-500');
      expect(result).toContain('hover:bg-blue-600');
      expect(result).toContain('focus:bg-blue-700');
      expect(result).toContain('active:bg-blue-800');
    });

    it('should deduplicate identical classes', () => {
      const result = cn('text-red-500', 'text-red-500', 'font-bold');
      
      // Should contain the class only once
      const matches = result.match(/text-red-500/g);
      expect(matches).toHaveLength(1);
      expect(result).toContain('font-bold');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long class names', () => {
      const longClassName = 'a'.repeat(1000);
      const result = cn('base', longClassName);
      
      expect(result).toContain('base');
      expect(result).toContain(longClassName);
    });

    it('should handle special characters in class names', () => {
      const result = cn('base-class', 'class-with-dashes', 'class_with_underscores');
      
      expect(result).toContain('base-class');
      expect(result).toContain('class-with-dashes');
      expect(result).toContain('class_with_underscores');
    });

    it('should handle numeric class names', () => {
      const result = cn('w-1/2', 'h-96', 'z-50');
      
      expect(result).toContain('w-1/2');
      expect(result).toContain('h-96');
      expect(result).toContain('z-50');
    });

    it('should handle empty input', () => {
      const result = cn();
      
      expect(typeof result).toBe('string');
      expect(result.trim()).toBe('');
    });

    it('should handle deeply nested conditions', () => {
      const condition1 = true;
      const condition2 = false;
      const condition3 = true;
      
      const result = cn(
        'base',
        condition1 && 'level1',
        condition1 && condition2 && 'level2',
        condition1 && condition3 && 'level3'
      );
      
      expect(result).toContain('base');
      expect(result).toContain('level1');
      expect(result).not.toContain('level2');
      expect(result).toContain('level3');
    });
  });

  describe('Performance', () => {
    it('should handle many classes efficiently', () => {
      const manyClasses = Array.from({ length: 100 }, (_, i) => `class-${i}`);
      const startTime = performance.now();
      
      const result = cn(...manyClasses);
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(100); // Should complete in less than 100ms
      expect(result).toContain('class-0');
      expect(result).toContain('class-99');
    });
  });
}); 