/// <reference types="jest" />
import { Validator } from "../domain/validations/ValidatorInterface";

export function contractTest<T>(
    name: string,
    factory: () => Validator,
    validInput: T,
    invalidInput: T
) {
    describe(`Contract test: ${name}`, () => {
        it('should validate valid input', () => {
            const errors = factory();
            expect(errors.validateData([validInput])).toEqual([]);
        });

        it('should invalidate invalid input', () => {
            const errors = factory();
            const result = errors.validateData([invalidInput]);
            expect(result.length).toBeGreaterThan(0);
        });
    });
}
