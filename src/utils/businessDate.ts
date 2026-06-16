export const getPreviousBusinessDay = (input: Date) => {
    const previous = new Date(input);
    previous.setDate(previous.getDate() - 1);

    while (previous.getDay() === 0 || previous.getDay() === 6) {
        previous.setDate(previous.getDate() - 1);
    }

    return previous;
};
